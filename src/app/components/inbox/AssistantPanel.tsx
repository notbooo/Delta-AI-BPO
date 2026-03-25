import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from 'react';
import {
  Sparkles, AlertTriangle, ChevronRight, ChevronDown,
  Zap, Shield, MessageSquare,
  BookOpen, ArrowRight, Loader2, Pencil,
  Bot, ArrowDown, Copy, RotateCcw, Trash2, Send, PawPrint
} from 'lucide-react';
import { toast } from 'sonner';
import { useAppContext } from '../../context/AppContext';
import { ScopeBadge } from '../shared/ScopeBadge';
import { MOCK_PROPERTIES } from '../../data/mock-data';
import type { Ticket } from '../../data/types';
import type { OnboardingSection } from '../../data/onboarding-template';
import {
  detectInquiries,
  classifyWithLLM,
  scoreKBForInquiry,
  filterGreetingNoise,
  type DetectedInquiry,
  type InquiryKBMatch,
} from './InquiryDetector';
import { askAI as askAIProxy, classifyInquiries as classifyInquiriesProxy } from '../../ai/api-client';
import { buildPropertyContext } from '../../ai/kb-context';
import {
  getChatHistory,
  saveChatHistory,
  clearChatHistory,
} from '../../ai/api-client';
import {
  ASK_AI_SYSTEM,
  ASK_AI_USER,
  interpolate,
} from '../../ai/prompts';

// Inquiry type → icon + color mapping
const INQUIRY_STYLE: Record<string, { icon: ReactNode; color: string; bg: string; border: string }> = {
  maintenance: { icon: <AlertTriangle size={12} />, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
  wifi: { icon: <Zap size={12} />, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
  checkout: { icon: <ChevronRight size={12} />, color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200' },
  checkin: { icon: <ChevronRight size={12} />, color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' },
  noise: { icon: <Shield size={12} />, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
  luggage: { icon: <BookOpen size={12} />, color: 'text-slate-600', bg: 'bg-slate-50', border: 'border-slate-200' },
  directions: { icon: <ArrowRight size={12} />, color: 'text-teal-600', bg: 'bg-teal-50', border: 'border-teal-200' },
  billing: { icon: <BookOpen size={12} />, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' },
  amenities: { icon: <Sparkles size={12} />, color: 'text-cyan-600', bg: 'bg-cyan-50', border: 'border-cyan-200' },
  pet: { icon: <PawPrint size={12} />, color: 'text-pink-600', bg: 'bg-pink-50', border: 'border-pink-200' },
  houserules: { icon: <Shield size={12} />, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' },
  general: { icon: <MessageSquare size={12} />, color: 'text-slate-600', bg: 'bg-slate-50', border: 'border-slate-200' },
};


interface AssistantPanelProps {
  ticket: Ticket;
  onComposeReply: (text: string) => void;
  onNavigateToKB: (propId: string) => void;
}

// ─── Form field extraction ───────────────────────────────────────────────────

/** Which form sections/fields are relevant per inquiry type */
const INQUIRY_FORM_MAP: Record<string, { sectionId: string; fieldIds?: string[] }[]> = {
  wifi:        [{ sectionId: 'wifi' }],
  checkin:     [
    { sectionId: 'checkinout', fieldIds: ['checkinTime', 'earlyCheckin', 'lateNightCheckin'] },
    { sectionId: 'access',     fieldIds: ['entryProcedure', 'lockType', 'lockTroubleshootingProperty'] },
  ],
  checkout:    [
    { sectionId: 'checkinout', fieldIds: ['checkoutTime', 'lateCheckout', 'checkoutProcedure'] },
  ],
  luggage:     [
    { sectionId: 'checkinout', fieldIds: ['luggageStorage'] },
    { sectionId: 'nearby',     fieldIds: ['coinLockers'] },
  ],
  maintenance: [
    { sectionId: 'emergency',  fieldIds: ['repairName', 'repairPhone', 'repairNotes', 'onsiteResponseName', 'onsiteResponsePhone', 'onsiteResponseNotes', 'nearestHospital'] },
  ],
  noise:       [{ sectionId: 'rules',    fieldIds: ['quietHours', 'partyPolicy', 'visitorPolicy'] }],
  pet:         [{ sectionId: 'rules',    fieldIds: ['petPolicy'] }],
  houserules:  [{ sectionId: 'rules' }],
  amenities:   [{ sectionId: 'amenities', fieldIds: ['kitchenEquipment', 'laundry', 'entertainment', 'otherCommonSupplies', 'toiletries', 'spareSupplies'] }],
  food:        [{ sectionId: 'nearby',   fieldIds: ['restaurants', 'convenienceStore', 'supermarket'] }],
  dining:      [{ sectionId: 'nearby',   fieldIds: ['restaurants', 'convenienceStore', 'supermarket'] }],
  restaurant:  [{ sectionId: 'nearby',   fieldIds: ['restaurants', 'convenienceStore', 'supermarket'] }],
  nearby:      [{ sectionId: 'nearby',   fieldIds: ['restaurants', 'convenienceStore', 'supermarket', 'touristSpots'] }],
  breakfast:   [{ sectionId: 'amenities', fieldIds: ['kitchenEquipment'] }],
  kitchen:     [{ sectionId: 'amenities', fieldIds: ['kitchenEquipment'] }],
  directions:  [
    { sectionId: 'access',  fieldIds: ['nearestStation', 'airportAccess', 'parkingInfo', 'bicycleParking'] },
    { sectionId: 'nearby',  fieldIds: ['transportDirections', 'transportApps'] },
  ],
  billing:     [{ sectionId: 'pricing', fieldIds: ['cancellationPolicy', 'sharedAdditionalFees', 'paymentMethods'] }],
  general:     [
    { sectionId: 'basics',     fieldIds: ['propertyName', 'address', 'propertyType'] },
    { sectionId: 'checkinout', fieldIds: ['checkinTime', 'checkoutTime'] },
  ],
};

interface FormFieldCard {
  id: string;
  label: string;
  value: string;
  sectionTitle: string;
  /** Set only for per-room sections — e.g. "Unit 1", "Room 2" */
  roomName?: string;
}

function extractFormFields(
  inqType: string,
  propId: string,
  onboardingData: Record<string, Record<string, string>>,
  formTemplate: OnboardingSection[],
  roomNames?: string[],
): FormFieldCard[] {
  const sectionGroups = INQUIRY_FORM_MAP[inqType] || [];
  const formData = onboardingData[propId] || {};
  const results: FormFieldCard[] = [];

  for (const { sectionId, fieldIds } of sectionGroups) {
    const section = formTemplate.find(s => s.id === sectionId);
    if (!section) continue;

    const fieldsToCheck = fieldIds
      ? section.fields.filter(f => fieldIds.includes(f.id))
      : section.fields.filter(f => !f.hostHidden);

    if (section.perRoom) {
      for (let r = 0; r < 20; r++) {
        let foundAny = false;
        for (const field of fieldsToCheck) {
          const val = formData[`${sectionId}__room${r}__${field.id}`]?.trim();
          if (val) {
            foundAny = true;
            results.push({ id: `${sectionId}-room${r}-${field.id}`, label: field.label, value: val, sectionTitle: section.title, roomName: roomNames?.[r] });
          }
        }
        if (!foundAny && r > 0) break;
      }
    } else {
      for (const field of fieldsToCheck) {
        const val = formData[`${sectionId}__${field.id}`]?.trim();
        if (val) results.push({ id: `${sectionId}-${field.id}`, label: field.label, value: val, sectionTitle: section.title });
      }
    }
  }

  return results;
}

/** Fallback inquiry used when LLM returns empty or fails */
function fallbackGeneralInquiry(ticket: Ticket): DetectedInquiry {
  return {
    id: 'inq-0',
    type: 'general',
    label: 'General Inquiry',
    detail: ticket.summary || 'Guest message requires review',
    confidence: 'low',
    relevantTags: ticket.tags,
    keywords: [],
  };
}

/** Generate a contextual quick-question chip for an inquiry */
function generateQuickQuestion(inq: DetectedInquiry, ticketProperty: string, ticketRoom: string): string {
  // AI-classified inquiries carry the guest's actual detail — use it directly
  if (inq.aiClassified && inq.detail && inq.detail.length > 15) {
    return `${inq.detail} — what do we know?`;
  }
  switch (inq.type) {
    case 'wifi': return `What's the Wi-Fi password for ${ticketRoom || ticketProperty}?`;
    case 'checkin': return `What are the check-in instructions for ${ticketRoom || ticketProperty}?`;
    case 'checkout': return `What's the checkout policy for ${ticketProperty}?`;
    case 'maintenance': return `Who handles maintenance at ${ticketProperty}?`;
    case 'noise': return `What are the quiet hours at ${ticketProperty}?`;
    case 'luggage': return `Is luggage storage available at ${ticketProperty}?`;
    case 'directions': return `How do guests get to ${ticketProperty}?`;
    case 'billing': return `What's the refund policy for ${ticketProperty}?`;
    case 'amenities': return `What amenities are available at ${ticketProperty}?`;
    case 'pet': return `What are the pet policies at ${ticketProperty}?`;
    case 'houserules': return `What are the house rules at ${ticketProperty}?`;
    default: {
      // For AI-classified inquiries, use the detail as a contextual question
      if (inq.aiClassified && inq.detail) {
        return `${inq.detail} — what do we know?`;
      }
      return `What should I know about ${ticketProperty}?`;
    }
  }
}

// ─── Chat message type ──────────────────────────────────
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  /** True when the AI response had no knowledge base articles to draw from */
  noKbContext?: boolean;
}

// Max conversation turns to send in the prompt (sliding window)
const MAX_CONTEXT_TURNS = 3; // 3 user+assistant pairs = 6 messages

export function AssistantPanel({ ticket, onComposeReply, onNavigateToKB }: AssistantPanelProps) {
  const { kbEntries, hasApiKey: hasApiKeyFromCtx, aiModel, onboardingData, formTemplate, properties } = useAppContext();
  const [isAnalyzing, setIsAnalyzing] = useState(true);
  const [expandedInquiry, setExpandedInquiry] = useState<string | null>(null);
  const [expandedArticle, setExpandedArticle] = useState<string | null>(null);

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Find property
  const activeProp = MOCK_PROPERTIES.find(p => p.name === ticket.property);
  const ticketRoom = ticket.room.replace(/[^0-9]/g, '');
  const hasApiKey = hasApiKeyFromCtx;

  // True when the property has any form data saved (excluding internal-only FAQs key)
  const hasFormData = useMemo(() => {
    const propData = onboardingData[activeProp?.id || ''] || {};
    return Object.keys(propData).some(k => k !== 'faqs__items' && propData[k]?.trim());
  }, [onboardingData, activeProp?.id]);

  // Scope-filtered knowledge base
  const scopeFilteredKb = useMemo(() => {
    return kbEntries.filter(kb =>
      kb.hostId === ticket.host.id &&
      (!kb.propId || kb.propId === activeProp?.id)
    );
  }, [kbEntries, ticket.host.id, activeProp?.id]);

  // Full property context — used by BOTH classify-inquiry and compose-reply
  const propContext = useMemo(() => {
    const prop = properties.find(p => p.name === ticket.property) ?? activeProp;
    const roomNames = prop?.roomNames ?? (prop?.units === 1 ? ['Entire Property'] : Array.from({ length: prop?.units ?? 1 }, (_, i) => `Unit ${i + 1}`));
    return buildPropertyContext(prop?.id ?? '', ticket.property, onboardingData, formTemplate, roomNames, scopeFilteredKb);
  }, [properties, ticket.property, activeProp, onboardingData, formTemplate, scopeFilteredKb]);

  // LLM-primary classification — always fires, regex only as no-API-key fallback
  const [aiInquiries, setAiInquiries] = useState<DetectedInquiry[] | null>(null);
  const llmClassifyRef = useRef<string | null>(null); // track ticket.id to avoid duplicate calls

  useEffect(() => {
    const guestMessages = ticket.messages
      .filter(m => m.sender === 'guest')
      .map(m => m.text);

    if (!hasApiKey) {
      // No API key — fall back to regex synchronously
      const fallback = filterGreetingNoise(detectInquiries(guestMessages, ticket.tags, ticket.summary));
      setAiInquiries(fallback);
      setIsAnalyzing(false);
      return;
    }

    // Don't re-classify the same ticket
    if (llmClassifyRef.current === ticket.id) return;
    llmClassifyRef.current = ticket.id;

    if (guestMessages.length === 0) {
      setAiInquiries([fallbackGeneralInquiry(ticket)]);
      setIsAnalyzing(false);
      return;
    }

    classifyWithLLM(
      guestMessages,
      ticket.property,
      ticket.host.name,
      (opts) => classifyInquiriesProxy({ ...opts, model: aiModel }),
      propContext,
    ).then(result => {
      console.log('[AssistantPanel] LLM classified %d inquiries', result.length);
      setAiInquiries(result.length > 0 ? result : [fallbackGeneralInquiry(ticket)]);
    }).catch(err => {
      console.error('[AssistantPanel] LLM classification failed, falling back to regex:', err);
      setAiInquiries(filterGreetingNoise(detectInquiries(guestMessages, ticket.tags, ticket.summary)));
    }).finally(() => {
      setIsAnalyzing(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.id, ticket, hasApiKey, aiModel, propContext]);

  // All inquiries come from LLM (or regex fallback when no API key)
  const inquiries = filterGreetingNoise(aiInquiries ?? []);

  // Score knowledge base per inquiry
  const kbMatchesByInquiry = useMemo(() => {
    const result: Record<string, InquiryKBMatch[]> = {};
    for (const inq of inquiries) {
      const withRoomBoost = scopeFilteredKb.map(kb => {
        if (kb.roomId && ticketRoom && kb.roomId === ticketRoom) {
          return { ...kb, tags: [...(kb.tags || []), '__room_match__'] };
        }
        return kb;
      });
      const matches = scoreKBForInquiry(inq, withRoomBoost);
      result[inq.id] = matches.map(m => ({
        ...m,
        score: m.entry.roomId && ticketRoom && m.entry.roomId === ticketRoom
          ? m.score + 50
          : m.score,
      })).sort((a, b) => b.score - a.score);
    }
    return result;
  }, [inquiries, scopeFilteredKb, ticketRoom]);

  // Extract relevant form fields per inquiry from onboardingData
  // Fields are deduplicated across inquiry cards — a field shown in card #1 won't repeat in card #2
  const formFieldsByInquiry = useMemo(() => {
    const prop = properties.find(p => p.name === ticket.property) ?? activeProp;
    const roomNames = prop?.roomNames
      ?? (prop?.units === 1 ? ['Entire Property'] : Array.from({ length: prop?.units ?? 1 }, (_, i) => `Unit ${i + 1}`));
    const result: Record<string, FormFieldCard[]> = {};
    const seenFieldIds = new Set<string>();
    for (const inq of inquiries) {
      const fields = extractFormFields(inq.type, activeProp?.id || '', onboardingData, formTemplate, roomNames)
        .filter(f => !seenFieldIds.has(f.id));
      for (const f of fields) seenFieldIds.add(f.id);
      result[inq.id] = fields;
    }
    return result;
  }, [inquiries, activeProp?.id, onboardingData, formTemplate, properties, ticket.property]);

  // Quick question chips (deduplicated by inquiry type)
  const quickQuestions = useMemo(() => {
    const seen = new Set<string>();
    return inquiries
      .filter(inq => { if (seen.has(inq.type)) return false; seen.add(inq.type); return true; })
      .map(inq => ({
        id: inq.id,
        question: generateQuickQuestion(inq, ticket.property, ticket.room),
        type: inq.type,
      }));
  }, [inquiries, ticket.property, ticket.room]);

  // Reset state + load chat on ticket switch
  // isAnalyzing is set to false by the classification effect when LLM returns
  useEffect(() => {
    setIsAnalyzing(true);
    setExpandedInquiry(null);
    setExpandedArticle(null);
    setInputText('');
    setIsThinking(false);
    setAiInquiries(null);
    setChatMessages([]); // Clear old thread's chat immediately
    llmClassifyRef.current = null;

    // Load persisted chat from backend
    let cancelled = false;
    getChatHistory(ticket.id).then(saved => {
      if (cancelled) return;
      setChatMessages(saved as ChatMessage[]);
    }).catch(() => {
      if (!cancelled) setChatMessages([]);
    });

    return () => { cancelled = true; };
  }, [ticket.id]);

  // Auto-expand the first inquiry once analysis completes
  useEffect(() => {
    if (!isAnalyzing && inquiries.length > 0 && expandedInquiry === null) {
      setExpandedInquiry(inquiries[0].id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAnalyzing]);

  // Persist chat to BE whenever messages change (debounced)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isAnalyzing) return; // Don't save during initial load
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveChatHistory(ticket.id, chatMessages);
    }, 400);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [chatMessages, ticket.id, isAnalyzing]);

  // Auto-scroll chat on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages.length, isThinking]);

  // ─── Build full property context for AI (form data + manual KB) ──────────────
  const getKBContext = useCallback((): string => {
    return propContext;
  }, [propContext]);

  // ─── Ask AI (chat-aware) ──────────────────────────────────────
  const handleSend = useCallback(async (overrideText?: string) => {
    const question = (overrideText || inputText).trim();
    if (!question || isThinking) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: question,
      timestamp: Date.now(),
    };

    setChatMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsThinking(true);

    if (hasApiKey) {
      try {
        const kbContext = getKBContext();

        // Build conversation context from sliding window
        const allMessages = [...chatMessages, userMsg];
        const recentPairs = allMessages.slice(-(MAX_CONTEXT_TURNS * 2));
        const conversationHistory = recentPairs.length > 1
          ? recentPairs.slice(0, -1) // exclude the current question (it goes in userPrompt)
              .map(m => `[${m.role === 'user' ? 'Agent' : 'AI'}] ${m.text}`)
              .join('\n')
          : '';

        const recentGuestMessages = ticket.messages
          .slice(-6)
          .map(m => `[${m.sender}] ${m.text}`)
          .join('\n');

        const userPrompt = interpolate(ASK_AI_USER, {
          propertyName: ticket.property,
          hostName: ticket.host.name,
          question: question,
          kbEntries: kbContext || '(no knowledge base articles available)',
        });

        const enrichedPrompt = [
          userPrompt,
          `\nRecent guest conversation:\n${recentGuestMessages}`,
          conversationHistory ? `\nPrior research chat (for context — the agent is following up):\n${conversationHistory}` : '',
        ].filter(Boolean).join('\n');

        const result = await askAIProxy({
          systemPrompt: ASK_AI_SYSTEM,
          userPrompt: enrichedPrompt,
          model: aiModel,
        });

        const assistantMsg: ChatMessage = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: result.text,
          timestamp: Date.now(),
          noKbContext: kbContext === '',
        };
        setChatMessages(prev => [...prev, assistantMsg]);
      } catch (err: any) {
        const errMsg: ChatMessage = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: `Error: ${err.message}`,
          timestamp: Date.now(),
        };
        setChatMessages(prev => [...prev, errMsg]);
      }
    } else {
      // Fallback: keyword search
      await new Promise(r => setTimeout(r, 500));
      const q = question.toLowerCase();
      const matches = scopeFilteredKb
        .map(kb => {
          const text = (kb.title + ' ' + kb.content).toLowerCase();
          const words = q.split(/\W+/).filter(w => w.length > 3);
          const hits = words.filter(w => text.includes(w));
          return { kb, score: hits.length };
        })
        .filter(m => m.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 2);

      const answer = matches.length > 0
        ? matches.map(m => `${m.kb.title}: ${m.kb.content}`).join('\n\n')
        : 'No relevant information found in the knowledge base for this property. You may want to check with the host directly or add a custom article for next time.';

      const assistantMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        text: answer,
        timestamp: Date.now(),
      };
      setChatMessages(prev => [...prev, assistantMsg]);
    }

    setIsThinking(false);
    inputRef.current?.focus();
  }, [inputText, isThinking, hasApiKey, aiModel, scopeFilteredKb, ticket, chatMessages, getKBContext]);

  const handleClearChat = useCallback(() => {
    setChatMessages([]);
    setInputText('');
    setIsThinking(false);
    clearChatHistory(ticket.id); // Delete from BE
    toast.success('Chat cleared');
    inputRef.current?.focus();
  }, [ticket.id]);

  const handleRefreshLast = useCallback(() => {
    // Re-ask the last user question
    const lastUserMsg = [...chatMessages].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) return;
    // Remove the last assistant response
    setChatMessages(prev => {
      const idx = prev.length - 1;
      if (idx >= 0 && prev[idx].role === 'assistant') return prev.slice(0, -1);
      return prev;
    });
    handleSend(lastUserMsg.text);
  }, [chatMessages, handleSend]);

  const handleInsertMsg = useCallback((text: string) => {
    onComposeReply(text);
    toast.success('Inserted into reply', { description: 'Review and edit before sending.' });
  }, [onComposeReply]);

  const handleCopyMsg = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  }, []);

  // ─── Analyzing skeleton ────────────────────────────────────────────
  if (isAnalyzing) {
    return (
      <div className="p-4 space-y-4 animate-pulse">
        <div className="flex items-center gap-2 text-indigo-600">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-xs font-bold">Analyzing conversation...</span>
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="space-y-2">
              <div className="h-3 bg-slate-200 rounded w-2/3" />
              <div className="h-2 bg-slate-100 rounded w-full" />
              <div className="h-2 bg-slate-100 rounded w-4/5" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">

        {/* ─── Ask AI — Chat Interface ─────────────────────────── */}
        <div className="flex flex-col border-b border-slate-100">
          {/* Header */}
          <div className="px-4 pt-3 pb-1 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot size={12} className="text-indigo-600" />
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ask AI</span>
              {hasApiKey && (
                <span className="text-[8px] bg-emerald-50 text-emerald-600 border border-emerald-200 px-1 py-0.5 rounded font-bold">Live</span>
              )}
            </div>
            {chatMessages.length > 0 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={handleRefreshLast}
                  disabled={isThinking || chatMessages.length === 0}
                  className="p-1 text-slate-400 hover:text-indigo-600 disabled:opacity-30 transition-colors rounded"
                  title="Re-ask last question"
                >
                  <RotateCcw size={11} />
                </button>
                <button
                  onClick={handleClearChat}
                  disabled={isThinking}
                  className="p-1 text-slate-400 hover:text-red-500 disabled:opacity-30 transition-colors rounded"
                  title="Clear conversation"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            )}
          </div>

          {/* Quick question chips — always visible, compact when chat has messages */}
          {quickQuestions.length > 0 && (
            <div className={`px-4 flex flex-wrap gap-1.5 ${chatMessages.length > 0 ? 'pb-1.5' : 'pb-2.5'}`}>
              {quickQuestions.map(qq => (
                <button
                  key={qq.id}
                  onClick={() => handleSend(qq.question)}
                  disabled={isThinking}
                  className="text-[10px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-1 rounded-full hover:bg-indigo-100 transition-colors disabled:opacity-50 truncate max-w-full"
                >
                  {qq.question}
                </button>
              ))}
            </div>
          )}

          {/* Chat messages area */}
          {(chatMessages.length > 0 || isThinking) && (
            <div className="px-3 pb-2 max-h-64 overflow-y-auto space-y-2">
              {chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-1 duration-150`}
                >
                  {msg.role === 'user' ? (
                    <div className="max-w-[85%] px-3 py-1.5 rounded-2xl rounded-tr-sm bg-indigo-600 text-white text-[11px] leading-relaxed">
                      {msg.text}
                    </div>
                  ) : (
                    <div className="max-w-[92%] group">
                      <div className="flex items-center gap-1 mb-0.5">
                        <Bot size={9} className="text-indigo-500" />
                        <span className="text-[9px] text-slate-400">AI</span>
                      </div>
                      <div className="px-2.5 py-2 bg-indigo-50 border border-indigo-200 rounded-2xl rounded-tl-sm text-[10px] text-slate-700 whitespace-pre-wrap leading-relaxed">
                        {msg.text}
                      </div>
                      {/* Action buttons */}
                      <div className="flex items-center gap-1 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleInsertMsg(msg.text)}
                          className="flex items-center gap-0.5 text-[9px] font-medium text-indigo-500 hover:text-indigo-700 px-1.5 py-0.5 rounded hover:bg-indigo-50 transition-colors"
                        >
                          <ArrowDown size={8} /> Insert
                        </button>
                        <button
                          onClick={() => handleCopyMsg(msg.text)}
                          className="flex items-center gap-0.5 text-[9px] font-medium text-slate-400 hover:text-slate-600 px-1.5 py-0.5 rounded hover:bg-slate-50 transition-colors"
                        >
                          <Copy size={8} /> Copy
                        </button>
                      </div>
                      {/* No coverage hint */}
                      {msg.noKbContext && (
                        <div className="flex items-center gap-1 mt-1 px-1">
                          <AlertTriangle size={8} className="text-amber-500" />
                          <span className="text-[8px] text-amber-600">No articles matched — consider adding one after resolving this.</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* Thinking indicator */}
              {isThinking && (
                <div className="flex items-start gap-1.5 animate-in fade-in duration-150">
                  <div className="flex items-center gap-1 mt-0.5">
                    <Bot size={9} className="text-indigo-500" />
                  </div>
                  <div className="px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-2xl rounded-tl-sm">
                    <div className="flex items-center gap-1.5">
                      <Loader2 size={10} className="animate-spin text-indigo-500" />
                      <span className="text-[10px] text-indigo-600">Thinking...</span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          )}

          {/* Input bar */}
          <div className="px-3 pb-3">
            <div className="relative flex items-center">
              <input
                ref={inputRef}
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder={chatMessages.length > 0 ? 'Follow up...' : 'Ask about this property...'}
                className="w-full border border-slate-200 rounded-xl py-2 pl-3 pr-16 text-[11px] focus:ring-1 focus:ring-indigo-500 outline-none transition-colors"
                disabled={isThinking}
              />
              <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                <button
                  onClick={() => handleSend()}
                  disabled={isThinking || !inputText.trim()}
                  className="p-1.5 rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-30 disabled:bg-slate-300 transition-all active:scale-95"
                >
                  {isThinking ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                </button>
              </div>
            </div>
            {chatMessages.length > 0 && (
              <div className="flex items-center justify-between mt-1 px-1">
                <span className="text-[9px] text-slate-300">
                  {chatMessages.filter(m => m.role === 'user').length} question{chatMessages.filter(m => m.role === 'user').length !== 1 ? 's' : ''}
                </span>
                <span className="text-[9px] text-slate-300">
                  last {MAX_CONTEXT_TURNS} exchanges
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ─── Background: What the guest needs ────────────────── */}
        <div className="p-3 pb-4">
          {/* Section header */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">What the guest needs</span>
            <span className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded-full font-bold tabular-nums">{inquiries.length}</span>
            <span className={`ml-auto text-[8px] font-semibold px-1.5 py-0.5 rounded-full border ${
              hasApiKey
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-slate-50 text-slate-500 border-slate-200'
            }`}>
              {hasApiKey ? 'Live AI' : 'Template'}
            </span>
          </div>

          {/* One card per detected intent */}
          <div className="space-y-2">
            {inquiries.map((inq, idx) => {
              const style = INQUIRY_STYLE[inq.type] || INQUIRY_STYLE.general;
              const isExpanded = expandedInquiry === inq.id;
              const matches = kbMatchesByInquiry[inq.id] || [];
              const formFields = formFieldsByInquiry[inq.id] || [];
              const coverageStatus = matches.length > 0 ? 'kb' : formFields.length > 0 ? 'form' : 'none';
              // For social/greeting inquiries where no KB lookup is needed, treat as 'ok' to suppress the yellow warning
              const needsKb = inq.needsKbSearch !== false;

              return (
                <div
                  key={inq.id}
                  className={`rounded-xl border overflow-hidden transition-all duration-200 ${style.border} ${isExpanded ? 'shadow-sm' : ''}`}
                >
                  {/* ── Card header (always visible) ── */}
                  {/* div+role instead of button so the inline Bot action doesn't nest inside a button */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setExpandedInquiry(isExpanded ? null : inq.id);
                      setExpandedArticle(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setExpandedInquiry(isExpanded ? null : inq.id);
                        setExpandedArticle(null);
                      }
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors cursor-pointer ${isExpanded ? style.bg : 'bg-white hover:bg-slate-50/80'}`}
                  >
                    {/* Intent icon in a tinted circle */}
                    <div className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${style.bg}`}>
                      <span className={style.color}>{style.icon}</span>
                    </div>

                    {/* Label + detail */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-bold text-slate-300 tabular-nums">#{idx + 1}</span>
                        <span className={`text-[11px] font-semibold leading-tight ${style.color}`}>{inq.label}</span>
                        {inq.aiClassified && (
                          <span className="text-[7px] font-bold text-violet-600 bg-violet-50 border border-violet-200 px-1 py-0.5 rounded">AI</span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400 truncate leading-tight mt-0.5">{inq.detail}</p>
                    </div>

                    {/* Coverage chip + chevron */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {coverageStatus === 'kb' && (
                        <span className="text-[9px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full tabular-nums">
                          {matches.length} {matches.length === 1 ? 'article' : 'articles'}
                        </span>
                      )}
                      {coverageStatus === 'form' && (
                        <span className="text-[8px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-0.5 tabular-nums">
                          <Sparkles size={7} /> {formFields.length} {formFields.length === 1 ? 'field' : 'fields'}
                        </span>
                      )}
                      {coverageStatus === 'none' && needsKb && (
                        <>
                          <span className="text-[8px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                            <AlertTriangle size={7} /> Gap
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSend(generateQuickQuestion(inq, ticket.property, ticket.room));
                            }}
                            className="shrink-0 p-1 rounded-lg bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 transition-colors"
                            title="Ask AI about this gap"
                          >
                            <Bot size={10} className="text-indigo-600" />
                          </button>
                        </>
                      )}
                      <ChevronDown
                        size={13}
                        className={`text-slate-300 transition-transform duration-200 ${isExpanded ? '' : '-rotate-90'}`}
                      />
                    </div>
                  </div>

                  {/* ── Expanded body ── */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 bg-white">

                      {/* KB article cards */}
                      {coverageStatus === 'kb' && (
                        <div className="p-2.5 space-y-1.5">
                          {matches.map((m) => {
                            const cardKey = `kb-${m.entry.id}`;
                            const isArticleOpen = expandedArticle === cardKey;
                            const isInternal = m.isActionable || m.entry.internal;
                            return (
                              <div
                                key={cardKey}
                                className={`rounded-lg border overflow-hidden transition-all duration-150 ${
                                  isInternal ? 'border-amber-200' : 'border-slate-200'
                                }`}
                              >
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedArticle(isArticleOpen ? null : cardKey);
                                  }}
                                  className={`w-full flex items-start gap-2.5 px-2.5 py-2 text-left transition-colors ${
                                    isInternal
                                      ? 'bg-amber-50/60 hover:bg-amber-50'
                                      : isArticleOpen
                                        ? 'bg-slate-50'
                                        : 'bg-white hover:bg-slate-50/70'
                                  }`}
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 mb-1">
                                      <span className="text-[11px] font-semibold text-slate-700 leading-tight">{m.entry.title}</span>
                                      {isInternal && (
                                        <span className="shrink-0 text-[7px] font-bold text-amber-700 bg-amber-100 px-1 py-0.5 rounded border border-amber-200">
                                          Agent-only
                                        </span>
                                      )}
                                    </div>
                                    <p className={`text-[10px] text-slate-500 leading-relaxed ${isArticleOpen ? '' : 'line-clamp-2'}`}>
                                      {m.entry.content}
                                    </p>
                                    {isArticleOpen && (
                                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                                        <ScopeBadge scope={m.entry.scope} />
                                        {m.entry.source === 'manual' && (
                                          <span className="text-[8px] text-indigo-600 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                            <Pencil size={7} /> Custom entry
                                          </span>
                                        )}
                                        {!m.entry.source && (
                                          <span className="text-[8px] text-slate-400 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded-full">
                                            Seed data
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  <ChevronDown
                                    size={11}
                                    className={`shrink-0 mt-0.5 text-slate-300 transition-transform duration-150 ${isArticleOpen ? '' : '-rotate-90'}`}
                                  />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Form field cards — actual values from onboarding form */}
                      {coverageStatus === 'form' && (
                        <div className="p-2.5 space-y-1.5">
                          {/* Subtle provenance note */}
                          <div className="flex items-center gap-1 px-0.5 mb-2">
                            <Sparkles size={8} className="text-emerald-500" />
                            <span className="text-[9px] text-emerald-600 font-medium">From property form · AI has this info</span>
                          </div>
                          {formFields.map((field) => {
                            const cardKey = `form-${field.id}`;
                            const isFieldOpen = expandedArticle === cardKey;
                            return (
                              <div key={cardKey} className="rounded-lg border border-slate-200 overflow-hidden transition-all duration-150">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedArticle(isFieldOpen ? null : cardKey);
                                  }}
                                  className={`w-full flex items-start gap-2.5 px-2.5 py-2 text-left transition-colors ${
                                    isFieldOpen ? 'bg-slate-50' : 'bg-white hover:bg-slate-50/70'
                                  }`}
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                                      <span className="text-[11px] font-semibold text-slate-700 leading-tight">{field.label}</span>
                                      {field.roomName && (
                                        <span className="text-[7px] font-semibold text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full leading-none">
                                          {field.roomName}
                                        </span>
                                      )}
                                    </div>
                                    <p className={`text-[10px] text-slate-500 leading-relaxed ${isFieldOpen ? '' : 'line-clamp-2'}`}>
                                      {field.value}
                                    </p>
                                    {isFieldOpen && (
                                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                                        <span className="text-[8px] text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                          <Sparkles size={7} /> Form · {field.sectionTitle}
                                        </span>
                                        {field.roomName && (
                                          <span className="text-[8px] text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full">
                                            {field.roomName}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  <ChevronDown
                                    size={11}
                                    className={`shrink-0 mt-0.5 text-slate-300 transition-transform duration-150 ${isFieldOpen ? '' : '-rotate-90'}`}
                                  />
                                </button>
                              </div>
                            );
                          })}
                          {/* Ask AI button at the bottom */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSend(generateQuickQuestion(inq, ticket.property, ticket.room));
                            }}
                            className="w-full mt-1 text-[10px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors flex items-center justify-center gap-1"
                          >
                            <Bot size={10} /> Ask AI about this
                          </button>
                        </div>
                      )}

                      {/* Not covered */}
                      {coverageStatus === 'none' && needsKb && (
                        <div className="p-3 space-y-2">
                          <div className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                            <AlertTriangle size={12} className="text-amber-500 shrink-0 mt-0.5" />
                            <div>
                              <p className="text-[10px] font-semibold text-amber-800">No info on file</p>
                              <p className="text-[9px] text-amber-600 mt-0.5 leading-relaxed">
                                {inq.detail || `Guest asked about ${inq.label.toLowerCase()}.`} — reply manually or add an article so AI can handle it next time.
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSend(generateQuickQuestion(inq, ticket.property, ticket.room));
                              }}
                              className="flex-1 text-[10px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors flex items-center justify-center gap-1"
                            >
                              <Bot size={10} /> Ask AI
                            </button>
                            {activeProp && (
                              <button
                                onClick={(e) => { e.stopPropagation(); onNavigateToKB(activeProp.id); }}
                                className="flex-1 text-[10px] font-medium text-slate-600 bg-white border border-slate-200 px-2.5 py-1.5 rounded-lg hover:bg-slate-50 transition-colors flex items-center justify-center gap-1"
                              >
                                <Pencil size={10} /> Add article
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}