/**
 * AI API Client — Frontend interface to the backend AI proxy.
 *
 * All OpenRouter calls go through the server so the API key
 * never reaches the browser. Settings are persisted in Supabase.
 */

import { projectId, publicAnonKey } from '/utils/supabase/info';
import { startDebugEntry, updateDebugEntry, type AIDebugEntry } from './debug-store';

const BASE_URL = `https://${projectId}.supabase.co/functions/v1/make-server-ab702ee0`;
const SUPABASE_REST_URL = `https://${projectId}.supabase.co/rest/v1`;

const headers = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${publicAnonKey}`,
});

const getPrefsHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${publicAnonKey}`,
  'Prefer': 'return=representation',
});

// ─── Types ──────────────────────────────────────────────

export interface AISettings {
  hasApiKey: boolean;
  maskedApiKey: string;
  model: string;
}

export interface AIProxyResult {
  text: string;
  tokensUsed: { prompt: number; completion: number; total: number } | null;
  model: string;
  durationMs: number;
}

// ─── Settings ───────────────────────────────────────────

export async function getAISettings(): Promise<AISettings> {
  const res = await fetch(`${BASE_URL}/ai/settings`, { headers: headers() });
  const json = await res.json();
  if (!res.ok) {
    console.error('Failed to fetch AI settings:', json);
    throw new Error(json.error || 'Failed to load AI settings');
  }
  return json;
}

export async function saveAISettings(updates: { apiKey?: string; model?: string }): Promise<AISettings> {
  const res = await fetch(`${BASE_URL}/ai/settings`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(updates),
  });
  const json = await res.json();
  if (!res.ok) {
    console.error('Failed to save AI settings:', json);
    throw new Error(json.error || 'Failed to save AI settings');
  }
  return json;
}

export async function clearAIKey(): Promise<AISettings> {
  const res = await fetch(`${BASE_URL}/ai/settings/key`, {
    method: 'DELETE',
    headers: headers(),
  });
  const json = await res.json();
  if (!res.ok) {
    console.error('Failed to clear AI key:', json);
    throw new Error(json.error || 'Failed to clear API key');
  }
  return json;
}

// ─── Agent Preferences ──────────────────────────────────

// Supabase client for direct persistence
let supabaseClient: any = null;
const getSupabaseClient = async () => {
  if (supabaseClient) return supabaseClient;
  const { createClient } = await import('@supabase/supabase-js');
  supabaseClient = createClient(
    `https://${projectId}.supabase.co`,
    publicAnonKey
  );
  return supabaseClient;
};

export async function getPreferences(): Promise<Record<string, any>> {
  try {
    const client = await getSupabaseClient();
    const { data, error } = await client
      .from('preferences')
      .select('*')
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
    return data?.data || {};
  } catch (err: any) {
    console.error('Failed to fetch preferences:', err);
    return {};
  }
}

export async function savePreferences(prefs: Record<string, any>): Promise<{ saved: string[] }> {
  try {
    const client = await getSupabaseClient();

    // Try upsert: insert or update
    const { error } = await client
      .from('preferences')
      .upsert({ id: 1, data: prefs }, { onConflict: 'id' });

    if (error) throw error;
    return { saved: Object.keys(prefs) };
  } catch (err: any) {
    console.error('Failed to save preferences:', err);
    throw new Error(err.message || 'Failed to save preferences');
  }
}

// ─── AI Proxy Calls ─────────────────────────────────────

interface ProxyCallOptions {
  endpoint: 'compose-reply' | 'ask';
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Label for the debug panel */
  touchpoint: AIDebugEntry['touchpoint'];
  /** File/document content to show in debug Attachment tab */
  attachment?: string;
  /** AbortSignal for cancellation — aborts the underlying fetch when triggered */
  signal?: AbortSignal;
}

async function proxyAICall(opts: ProxyCallOptions): Promise<AIProxyResult> {
  const entryId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const startMs = performance.now();

  // Register in-flight entry immediately so the debug panel shows it as pending
  startDebugEntry({
    id: entryId,
    timestamp: Date.now(),
    touchpoint: opts.touchpoint,
    model: opts.model || '(server default)',
    systemPrompt: opts.systemPrompt,
    userPrompt: opts.userPrompt,
    attachment: opts.attachment ?? null,
    response: null,
    durationMs: null,
    tokensUsed: null,
    error: false,
    status: null,
  });

  try {
    const res = await fetch(`${BASE_URL}/ai/${opts.endpoint}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        systemPrompt: opts.systemPrompt,
        userPrompt: opts.userPrompt,
        model: opts.model,
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
      }),
      signal: opts.signal,
    });

    const clientDuration = Math.round(performance.now() - startMs);
    const json = await res.json();

    if (!res.ok) {
      const errMsg = json?.error || JSON.stringify(json);
      updateDebugEntry(entryId, {
        response: `Error: ${errMsg}`,
        durationMs: json.durationMs || clientDuration,
        model: json.model || opts.model || '(server default)',
        error: true,
        status: json.status || res.status,
      });
      throw new Error(errMsg);
    }

    updateDebugEntry(entryId, {
      response: json.text,
      durationMs: json.durationMs || clientDuration,
      model: json.model,
      tokensUsed: json.tokensUsed,
      status: json.status || 200,
    });

    return {
      text: json.text,
      tokensUsed: json.tokensUsed,
      model: json.model,
      durationMs: json.durationMs || clientDuration,
    };
  } catch (err: any) {
    const clientDuration = Math.round(performance.now() - startMs);
    // Don't log AbortError as a real error — it's intentional cancellation
    if (err.name === 'AbortError') {
      updateDebugEntry(entryId, {
        response: 'Cancelled by user',
        durationMs: clientDuration,
        error: true,
        status: null,
      });
      throw err;
    }
    updateDebugEntry(entryId, {
      response: `Network error: ${err.message}`,
      durationMs: clientDuration,
      error: true,
      status: null,
    });
    throw err;
  }
}

/** Compose a guest reply via the server-side OpenRouter proxy */
export async function composeReplyAI(opts: {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  signal?: AbortSignal;
}): Promise<AIProxyResult> {
  return proxyAICall({
    endpoint: 'compose-reply',
    systemPrompt: opts.systemPrompt,
    userPrompt: opts.userPrompt,
    model: opts.model,
    temperature: 0.7,
    maxTokens: 1500,
    touchpoint: 'compose-reply',
    signal: opts.signal,
  });
}

/** Ask AI a KB-grounded question via the server-side OpenRouter proxy */
export async function askAI(opts: {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
}): Promise<AIProxyResult> {
  return proxyAICall({
    endpoint: 'ask',
    systemPrompt: opts.systemPrompt,
    userPrompt: opts.userPrompt,
    model: opts.model,
    temperature: 0.4,
    maxTokens: 512,
    touchpoint: 'ask-ai',
  });
}

/** Classify guest inquiries via LLM (lightweight structured classification) */
export async function classifyInquiries(opts: {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
}): Promise<AIProxyResult> {
  return proxyAICall({
    endpoint: 'ask',
    systemPrompt: opts.systemPrompt,
    userPrompt: opts.userPrompt,
    model: opts.model,
    temperature: 0.2,
    maxTokens: 384,
    touchpoint: 'classify-inquiry',
  });
}

/** Import a document via the server-side AI proxy (no client-side API key needed) */
export async function importDocumentAI(opts: {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  /** Raw file content shown in the debug Attachment tab */
  attachment?: string;
}): Promise<AIProxyResult> {
  return proxyAICall({
    endpoint: 'ask',
    systemPrompt: opts.systemPrompt,
    userPrompt: opts.userPrompt,
    model: opts.model,
    temperature: 0.3,
    maxTokens: 3000,
    touchpoint: 'kb-document-import',
    attachment: opts.attachment,
  });
}

// ─── Ask AI Chat History ────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

const CHAT_LS_PREFIX = 'askAiChat_';

/** Load saved chat messages for a ticket (backend with localStorage fallback) */
export async function getChatHistory(ticketId: string): Promise<ChatMessage[]> {
  // Try backend first
  try {
    const res = await fetch(`${BASE_URL}/ai/chat/${encodeURIComponent(ticketId)}`, { headers: headers() });
    const json = await res.json();
    if (res.ok && json.messages?.length) {
      // Sync to localStorage as cache
      try { localStorage.setItem(`${CHAT_LS_PREFIX}${ticketId}`, JSON.stringify(json.messages)); } catch {}
      return json.messages;
    }
  } catch {
    // Network error — fall through to localStorage
  }
  // Fallback: localStorage
  try {
    const stored = localStorage.getItem(`${CHAT_LS_PREFIX}${ticketId}`);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

/** Save chat messages for a ticket (backend + localStorage) */
export async function saveChatHistory(ticketId: string, messages: ChatMessage[]): Promise<void> {
  // Always persist to localStorage immediately
  try { localStorage.setItem(`${CHAT_LS_PREFIX}${ticketId}`, JSON.stringify(messages)); } catch {}
  // Best-effort backend save
  try {
    await fetch(`${BASE_URL}/ai/chat/${encodeURIComponent(ticketId)}`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ messages }),
    });
  } catch {
    // Silently swallow — localStorage has the data
  }
}

/** Clear chat messages for a ticket */
export async function clearChatHistory(ticketId: string): Promise<void> {
  try { localStorage.removeItem(`${CHAT_LS_PREFIX}${ticketId}`); } catch {}
  try {
    await fetch(`${BASE_URL}/ai/chat/${encodeURIComponent(ticketId)}`, {
      method: 'DELETE',
      headers: headers(),
    });
  } catch {
    // Silently swallow
  }
}

