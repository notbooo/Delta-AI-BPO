import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import type { Ticket, Task, KBEntry, Host, Message } from '../data/types';
import { MOCK_TICKETS, INITIAL_TASKS, MOCK_KB, MOCK_HOSTS, MOCK_PROPERTIES } from '../data/mock-data';
import type { Property } from '../data/types';
import { parseThreadStatus } from '../data/types';
import { PREFILLED_ONBOARDING } from '../data/onboarding-prefill';
import { ONBOARDING_SECTIONS as STATIC_SECTIONS } from '../data/onboarding-template';
import type { OnboardingSection, OnboardingField } from '../data/onboarding-template';
import { clearDebugEntries } from '../ai/debug-store';
import { MessageSquare } from 'lucide-react';
import { detectInquiries } from '../components/inbox/InquiryDetector';
import { projectId, publicAnonKey } from '/utils/supabase/info';

// Lazy-load the API client so a module-level error in api-client.ts
// cannot crash the entire AppProvider during initialization.
const getApiClient = () => import('../ai/api-client');

// Auth headers for Supabase Functions
const getSupabaseHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${publicAnonKey}`,
});

export interface Notification {
  id: string;
  title: string;
  message: string;
  time: string;
  read: boolean;
  type: 'ticket' | 'task' | 'system';
}

export interface HostSettings {
  hostId: string;
  tone: string;
  autoReply: boolean;
  autoReplyMode: 'auto' | 'draft' | 'assist';  // auto=sends immediately, draft=holds for review, assist=sidebar only
  // Auto-reply behavior settings
  partialCoverage: 'answer-and-escalate' | 'escalate-all';  // Track 3: answer what we can, or escalate everything
  zeroCoverage: 'holding-message' | 'silent-escalate';       // Track 2: send holding msg or just route to agent
  cooldownEnabled: boolean;       // Pause AI after agent reply
  cooldownMinutes: number;        // How long to pause (default 10)
  debouncePreset: 'instant' | 'quick' | 'normal' | 'patient';  // 0s / 10s / 30s / 60s
  safetyKeywords: string[];       // Always-escalate keywords (weapons, threats, etc.)
  /** Active hours — when outside this window the AI sets realistic expectations on response time */
  activeHours: {
    enabled: boolean;
    startHour: number;   // 0–23, local time
    endHour: number;     // 0–23, local time (exclusive)
    displayHours: string; // Human-readable, e.g. "9am–9pm daily"
  };
  demoFeatures: {
    showTasks: boolean;               // Show Tasks in sidebar
    showAnalytics: boolean;           // Show Analytics in sidebar
    showNotifications: boolean;       // Show Notifications settings tab
    showWorkingHours: boolean;        // Show Working Hours settings tab
    showResponseTimeRules: boolean;   // Show Response Time Rules (SLA) settings tab
    showQuickReplyTemplates: boolean; // Show Quick Reply Templates settings tab
    showTicketDistribution: boolean;  // Show Ticket Distribution settings tab
    showQualityPerformance: boolean;  // Show Quality & Performance settings tab
    showZoomOverride: boolean;        // Show zoom control in TopBar
    guestNeedsMode: 'ai-context' | 'kb-scoring'; // How "What the Guest Needs" works
  };
}

export interface NotificationPrefs {
  emailAlerts: boolean;
  soundAlerts: boolean;
  escalationAlerts: boolean;
  notifyAutoReply: boolean;
  notifyEscalation: boolean;
  notifyDraft: boolean;
}

export interface FormPhase {
  id: number;
  label: string;
  color: string; // tailwind color token e.g. 'red', 'blue', 'green'
}

const DEFAULT_PHASES: FormPhase[] = [
  { id: 1, label: 'Critical', color: 'red' },
  { id: 2, label: 'Guest Experience', color: 'blue' },
];

interface AppState {
  // Global filter
  activeHostFilter: string;
  setActiveHostFilter: (v: string) => void;

  // Tickets
  tickets: Ticket[];
  resolveTicket: (id: string) => void;
  addMessageToTicket: (ticketId: string, text: string) => void;
  injectGuestMessage: (ticketId: string, text: string, isGuestMode?: boolean) => void;
  addBotMessage: (ticketId: string, text: string) => void;
  addSystemMessage: (ticketId: string, text: string) => void;
  addMultipleMessages: (ticketId: string, messages: { sender: Message['sender']; text: string }[]) => void;
  escalateTicketStatus: (ticketId: string) => void;
  escalateTicketWithUrgency: (ticketId: string, level: 'warning' | 'urgent', sla: string) => void;
  deescalateTicket: (ticketId: string) => void;
  deleteMessageFromTicket: (ticketId: string, messageId: number) => void;
  deleteThread: (ticketId: string) => void;

  // Auto-reply processing state (for UI loading indicators)
  autoReplyProcessing: Record<string, boolean>;
  setAutoReplyProcessing: (ticketId: string, processing: boolean) => void;
  autoReplyCancelledRef: React.MutableRefObject<Record<string, boolean>>;
  /** Registry of AbortControllers per ticket — used to cancel in-flight AI HTTP requests */
  autoReplyAbortControllers: React.MutableRefObject<Record<string, AbortController>>;
  cancelAutoReply: (ticketId: string) => void;
  autoReplyPausedTickets: Record<string, boolean>;
  toggleAutoReplyPause: (ticketId: string) => void;
  autoReplyHandedOff: Record<string, boolean>;
  setAutoReplyHandedOff: (ticketId: string, handedOff: boolean) => void;
  resumeAllAI: () => void;

  // Draft replies (for draft auto-reply mode)
  draftReplies: Record<string, string>;
  setDraftReply: (ticketId: string, text: string) => void;
  clearDraftReply: (ticketId: string) => void;

  // Tasks
  tasks: Task[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  addTask: (task: Omit<Task, 'id'>) => void;
  updateTaskStatus: (id: string, status: Task['status']) => void;
  deleteTask: (id: string) => void;

  // KB
  kbEntries: KBEntry[];
  addKBEntry: (entry: Omit<KBEntry, 'id'>) => void;
  updateKBEntry: (id: number, updates: Partial<KBEntry>) => void;
  deleteKBEntry: (id: number) => void;
  deleteKBEntriesBySource: (propId: string, source: 'onboarding' | 'manual') => void;

  // Properties (mutable for status updates)
  properties: Property[];
  addProperty: (prop: Property) => void;
  updatePropertyStatus: (id: string, status: Property['status']) => void;
  updatePropertyMeta: (id: string, updates: Partial<Property>) => void;
  deleteProperty: (id: string) => void;

  // Onboarding form data: { [propertyId]: { [sectionId__fieldId]: value } }
  onboardingData: Record<string, Record<string, string>>;
  setOnboardingField: (propertyId: string, key: string, value: string) => void;
  setOnboardingBulk: (propertyId: string, data: Record<string, string>) => void;
  formPersistStatus: 'local' | 'server' | 'syncing';

  // Custom form sections per property
  customFormSections: Record<string, { id: string; title: string }[]>;
  addCustomFormSection: (propertyId: string, title: string) => string;
  removeCustomFormSection: (propertyId: string, sectionId: string) => void;
  renameCustomFormSection: (propertyId: string, sectionId: string, title: string) => void;

  // Notifications
  notifications: Notification[];
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  unreadCount: number;

  // Host settings
  hostSettings: HostSettings[];
  updateHostSettings: (hostId: string, updates: Partial<HostSettings>) => void;

  // Notification preferences
  notificationPrefs: NotificationPrefs;
  updateNotificationPrefs: (updates: Partial<NotificationPrefs>) => void;

  // Agent preferences
  darkMode: boolean;
  setDarkMode: (v: boolean) => void;
  devMode: boolean;
  setDevMode: (v: boolean) => void;
  agentName: string;
  setAgentName: (v: string) => void;
  defaultLanguage: string;
  setDefaultLanguage: (v: string) => void;

  // AI / OpenRouter
  openRouterApiKey: string;
  setOpenRouterApiKey: (v: string) => void;
  aiModel: string;
  setAiModel: (v: string) => void;
  importAiModel: string;
  setImportAiModel: (v: string) => void;
  hasApiKey: boolean;
  maskedApiKey: string;
  aiSettingsLoading: boolean;
  saveAIApiKey: (key: string) => Promise<void>;
  saveAIModel: (model: string) => Promise<void>;
  saveImportAiModel: (model: string) => Promise<void>;
  clearAIApiKey: () => Promise<void>;
  refreshAISettings: () => Promise<void>;

  // Form template (mutable copy of onboarding sections)
  formTemplate: OnboardingSection[];
  updateFormSection: (sectionId: string, updates: Partial<OnboardingSection>) => void;
  addFormSection: (section: OnboardingSection) => void;
  removeFormSection: (sectionId: string) => void;
  reorderFormSections: (fromIndex: number, toIndex: number) => void;
  updateFormField: (sectionId: string, fieldId: string, updates: Partial<OnboardingField>) => void;
  addFormField: (sectionId: string, field: OnboardingField) => void;
  removeFormField: (sectionId: string, fieldId: string) => void;
  reorderFormFields: (sectionId: string, fromIndex: number, toIndex: number) => void;
  resetFormTemplate: () => void;

  // Form phases
  formPhases: FormPhase[];
  addFormPhase: (phase: FormPhase) => void;
  updateFormPhase: (id: number, updates: Partial<Omit<FormPhase, 'id'>>) => void;
  removeFormPhase: (id: number) => void;
  reorderFormPhases: (fromIndex: number, toIndex: number) => void;
  resetFormPhases: () => void;

  // Reset everything to original demo state
  resetToDemo: () => void;

  // Create a fresh test ticket
  createTestTicket: (opts: { hostId: string; propertyName: string; guestName: string; firstMessage: string }) => string;
}

const AppContext = createContext<AppState | null>(null);

const DEFAULT_SAFETY_KEYWORDS = [
  'weapon', 'gun', 'knife', 'firearm', 'drugs', 'narcotics',
  'suicide', 'self-harm', 'threat', 'assault', 'violence',
  'fire', 'flood', 'gas leak', 'carbon monoxide',
  'medical emergency', 'ambulance', 'police', 'intruder', 'break-in',
];

function makeDefaultHostSettings(h: Host): HostSettings {
  return {
    hostId: h.id, tone: h.tone, autoReply: false,
    autoReplyMode: 'auto' as const,
    partialCoverage: 'answer-and-escalate',
    zeroCoverage: 'holding-message',
    cooldownEnabled: false,
    cooldownMinutes: 10,
    debouncePreset: 'instant',
    safetyKeywords: [...DEFAULT_SAFETY_KEYWORDS],
    activeHours: { enabled: false, startHour: 9, endHour: 21, displayHours: '9am–9pm daily' },
    demoFeatures: {
      showTasks: false,
      showAnalytics: false,
      showNotifications: false,
      showWorkingHours: false,
      showResponseTimeRules: false,
      showQuickReplyTemplates: false,
      showTicketDistribution: false,
      showQualityPerformance: false,
      showZoomOverride: false,
      guestNeedsMode: 'ai-context',
    },
  };
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [activeHostFilter, setActiveHostFilter] = useState('all');
  const [tickets, setTickets] = useState<Ticket[]>(MOCK_TICKETS);
  const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS);
  const [kbEntries, setKbEntries] = useState<KBEntry[]>(MOCK_KB);
  const [darkMode, setDarkModeRaw] = useState(false);
  const [devModeRaw, setDevModeRaw] = useState(false);
  const [agentNameRaw, setAgentNameRaw] = useState('Agent Felix');
  const [defaultLanguageRaw, setDefaultLanguageRaw] = useState('en');

  // ─── BE-persisted preferences ────────────────────────────
  // Per-key debounce timers (#20) — prevents race where rapid changes clobber each other
  const prefsSaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Debounced save to backend — each key gets its own independent timer
  const syncPrefToBackend = useCallback((key: string, value: any) => {
    if (prefsSaveTimersRef.current[key]) clearTimeout(prefsSaveTimersRef.current[key]);
    prefsSaveTimersRef.current[key] = setTimeout(async () => {
      try {
        const { savePreferences } = await getApiClient();
        await savePreferences({ [key]: value });
      } catch (err) {
        console.error(`Failed to persist preference "${key}" to backend:`, err);
      }
    }, 300);
  }, []);

  const setDevMode = useCallback((v: boolean) => {
    setDevModeRaw(v);
    syncPrefToBackend('devMode', v);
  }, [syncPrefToBackend]);

  const setDarkMode = useCallback((v: boolean) => {
    setDarkModeRaw(v);
    syncPrefToBackend('darkMode', v);
  }, [syncPrefToBackend]);

  const setAgentName = useCallback((v: string) => {
    setAgentNameRaw(v);
    syncPrefToBackend('agentName', v);
  }, [syncPrefToBackend]);

  const setDefaultLanguage = useCallback((v: string) => {
    setDefaultLanguageRaw(v);
    syncPrefToBackend('defaultLanguage', v);
  }, [syncPrefToBackend]);

  // Load preferences from backend on mount
  const prefsLoadedRef = useRef(false);
  useEffect(() => {
    if (prefsLoadedRef.current) return;
    prefsLoadedRef.current = true;
    (async () => {
      try {
        const { getPreferences } = await getApiClient();
        const prefs = await getPreferences();
        if (typeof prefs.devMode === 'boolean') setDevModeRaw(prefs.devMode);
        if (typeof prefs.darkMode === 'boolean') setDarkModeRaw(prefs.darkMode);
        if (typeof prefs.agentName === 'string' && prefs.agentName) setAgentNameRaw(prefs.agentName);
        if (typeof prefs.defaultLanguage === 'string' && prefs.defaultLanguage) setDefaultLanguageRaw(prefs.defaultLanguage);
        if (Array.isArray(prefs.hostSettings)) setHostSettings(prefs.hostSettings);
        if (prefs.notificationPrefs && typeof prefs.notificationPrefs === 'object') {
          setNotificationPrefs(prev => ({ ...prev, ...prefs.notificationPrefs }));
        }

        // Load properties from dedicated table
        try {
          const { getProperties } = await getApiClient();
          const props = await getProperties();
          if (Array.isArray(props) && props.length > 0) setProperties(props);
        } catch (err) {
          console.error('Failed to load properties:', err);
        }

        // Load persisted ticket state (messages + resolved IDs)
        if (prefs.ticketState) {
          try {
            const state = typeof prefs.ticketState === 'string'
              ? JSON.parse(prefs.ticketState) : prefs.ticketState;
            const { messages, resolvedIds, customTickets } = state as {
              messages: Record<string, any[]>;
              resolvedIds: string[];
              customTickets?: any[];
            };
            skipNextTicketSaveRef.current = true;
            const restoredMock = MOCK_TICKETS
              .filter(t => !(resolvedIds || []).includes(t.id))
              .map(t => messages?.[t.id]
                ? { ...t, messages: messages[t.id] }
                : t
              );
            // Restore custom (test) tickets that were created via createTestTicket
            const restoredCustom = (customTickets || []).map((ct: any) => ({
              ...ct,
              channelIcon: MessageSquare, // Re-attach icon component (not serializable)
            }));
            setTickets([...restoredCustom, ...restoredMock]);
          } catch (parseErr) {
            console.error('Failed to parse saved ticket state:', parseErr);
          }
        }
        ticketsLoadedRef.current = true;
      } catch (err) {
        console.error('Failed to load preferences from backend:', err);
        ticketsLoadedRef.current = true;
      }
    })();
  }, []);

  // Load KB entries from database on app startup (Supabase) or localStorage (dev fallback)
  useEffect(() => {
    const loadKBFromDatabase = async () => {
      // Try localStorage first (fast, reliable)
      const localData = localStorage.getItem('kb_entries_all');
      if (localData) {
        try {
          const entries = JSON.parse(localData);
          if (Array.isArray(entries) && entries.length > 0) {
            // Filter out stale form-derived entries — form data is now used directly for AI context
            const manualOnly = entries.filter((e: { source?: string }) => e.source !== 'onboarding');
            console.log(`[KB Load] ✓ Loaded ${manualOnly.length} manual entries from localStorage`);
            setKbEntries(manualOnly);
            return;
          }
        } catch {}
      }
      console.log('[KB Load] No persisted data found, using MOCK_KB');
    };
    loadKBFromDatabase();
  }, []);

  const [formPersistStatus, setFormPersistStatus] = useState<'local' | 'server' | 'syncing'>('local');

  const [openRouterApiKey, setOpenRouterApiKeyRaw] = useState(() => {
    try {
      // Try to get from localStorage first
      const cached = localStorage.getItem('openRouterApiKey');
      if (cached) return cached;
      // Try alternate key names for backwards compatibility
      return localStorage.getItem('openrouter_api_key') || '';
    } catch {
      return '';
    }
  });
  const setOpenRouterApiKey = useCallback((v: string) => {
    setOpenRouterApiKeyRaw(v);
    try {
      localStorage.setItem('openRouterApiKey', v);
      localStorage.setItem('openrouter_api_key', v); // Also save with alternate key for compatibility
    } catch {}
  }, []);

  const [aiModel, setAiModelRaw] = useState(() => {
    try { return localStorage.getItem('aiModel') || 'openai/gpt-4o-mini'; } catch { return 'openai/gpt-4o-mini'; }
  });
  const setAiModel = useCallback((v: string) => {
    setAiModelRaw(v);
    try { localStorage.setItem('aiModel', v); } catch {}
  }, []);

  const [importAiModel, setImportAiModelRaw] = useState(() => {
    try { return localStorage.getItem('importAiModel') || 'anthropic/claude-3.5-sonnet'; } catch { return 'anthropic/claude-3.5-sonnet'; }
  });
  const setImportAiModel = useCallback((v: string) => {
    setImportAiModelRaw(v);
    try { localStorage.setItem('importAiModel', v); } catch {}
  }, []);

  const [notifications, setNotifications] = useState<Notification[]>([
    { id: 'n1', title: 'New Escalation', message: 'Elena Rodriguez - AC issue at Villa Azure escalated by AI', time: '2 min ago', read: false, type: 'ticket' },
    { id: 'n2', title: 'Task Overdue', message: 'Mid-stay Cleaning for Shinjuku Lofts 402 is approaching deadline', time: '15 min ago', read: false, type: 'task' },
    { id: 'n3', title: 'Knowledge Base Updated', message: 'Urban Stays Co. luggage policy was modified by Admin', time: '1 hr ago', read: true, type: 'system' },
  ]);

  const [hostSettings, setHostSettings] = useState<HostSettings[]>(
    MOCK_HOSTS.map(h => makeDefaultHostSettings(h))
  );

  // ─── Notification preferences (persisted to backend) ─────
  const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
    emailAlerts: true, soundAlerts: true, escalationAlerts: true,
    notifyAutoReply: true, notifyEscalation: true, notifyDraft: true,
  };
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const updateNotificationPrefs = useCallback((updates: Partial<NotificationPrefs>) => {
    setNotificationPrefs(prev => {
      const next = { ...prev, ...updates };
      syncPrefToBackend('notificationPrefs', next);
      return next;
    });
  }, [syncPrefToBackend]);

  const [properties, setProperties] = useState<Property[]>(MOCK_PROPERTIES);
  const [onboardingData, setOnboardingData] = useState<Record<string, Record<string, string>>>(() => {
    try {
      const stored = localStorage.getItem('onboardingData');
      return stored ? JSON.parse(stored) : PREFILLED_ONBOARDING;
    } catch { return PREFILLED_ONBOARDING; }
  });
  const onboardingDataRef = useRef(onboardingData);
  useEffect(() => { onboardingDataRef.current = onboardingData; }, [onboardingData]);
  const [customFormSections, setCustomFormSections] = useState<Record<string, { id: string; title: string }[]>>({});
  // #14: Persist draft replies to localStorage so they survive page refresh
  const [draftReplies, setDraftRepliesState] = useState<Record<string, string>>(() => {
    try { const s = localStorage.getItem('draftReplies'); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });

  // ─── Auto-reply processing / cancellation / pause state ───────
  const [autoReplyProcessing, setAutoReplyProcessingState] = useState<Record<string, boolean>>({});
  const autoReplyCancelledRef = useRef<Record<string, boolean>>({});
  const autoReplyAbortControllers = useRef<Record<string, AbortController>>({});
  const [autoReplyPausedTickets, setAutoReplyPausedTickets] = useState<Record<string, boolean>>(() => {
    try { const s = localStorage.getItem('autoReplyPausedTickets'); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });
  const [autoReplyHandedOff, setAutoReplyHandedOffState] = useState<Record<string, boolean>>(() => {
    try { const s = localStorage.getItem('autoReplyHandedOff'); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });

  const setAutoReplyProcessing = useCallback((ticketId: string, processing: boolean) => {
    setAutoReplyProcessingState(prev => ({ ...prev, [ticketId]: processing }));
  }, []);

  const cancelAutoReply = useCallback((ticketId: string) => {
    autoReplyCancelledRef.current[ticketId] = true;
    setAutoReplyProcessingState(prev => ({ ...prev, [ticketId]: false }));
    const abortController = autoReplyAbortControllers.current[ticketId];
    if (abortController) {
      abortController.abort();
      delete autoReplyAbortControllers.current[ticketId];
    }
  }, []);

  const toggleAutoReplyPause = useCallback((ticketId: string) => {
    setAutoReplyPausedTickets(prev => ({ ...prev, [ticketId]: !prev[ticketId] }));
  }, []);

  const setAutoReplyHandedOff = useCallback((ticketId: string, handedOff: boolean) => {
    setAutoReplyHandedOffState(prev => ({ ...prev, [ticketId]: handedOff }));
  }, []);

  // Persist paused/handed-off state to localStorage
  useEffect(() => {
    try { localStorage.setItem('autoReplyPausedTickets', JSON.stringify(autoReplyPausedTickets)); } catch {}
  }, [autoReplyPausedTickets]);

  useEffect(() => {
    try { localStorage.setItem('autoReplyHandedOff', JSON.stringify(autoReplyHandedOff)); } catch {}
  }, [autoReplyHandedOff]);

  // #14: Persist drafts to localStorage
  useEffect(() => {
    try { localStorage.setItem('draftReplies', JSON.stringify(draftReplies)); } catch {}
  }, [draftReplies]);

  const setDraftReply = useCallback((ticketId: string, text: string) => {
    setDraftRepliesState(prev => ({ ...prev, [ticketId]: text }));
  }, []);

  const clearDraftReply = useCallback((ticketId: string) => {
    setDraftRepliesState(prev => {
      const next = { ...prev };
      delete next[ticketId];
      return next;
    });
  }, []);

  const [formTemplate, setFormTemplateRaw] = useState<OnboardingSection[]>(() => {
    try {
      const saved = localStorage.getItem('formTemplate');
      if (saved) return JSON.parse(saved);
    } catch {}
    return STATIC_SECTIONS;
  });

  const [formPhases, setFormPhasesRaw] = useState<FormPhase[]>(() => {
    try {
      const saved = localStorage.getItem('formPhases');
      if (saved) return JSON.parse(saved);
    } catch {}
    return DEFAULT_PHASES;
  });

  // Persist to localStorage on every change
  const setFormTemplate = useCallback((val: OnboardingSection[] | ((prev: OnboardingSection[]) => OnboardingSection[])) => {
    setFormTemplateRaw(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      try { localStorage.setItem('formTemplate', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const setFormPhases = useCallback((val: FormPhase[] | ((prev: FormPhase[]) => FormPhase[])) => {
    setFormPhasesRaw(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      try { localStorage.setItem('formPhases', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const resolveTicket = useCallback((id: string) => {
    setTickets(prev => prev.filter(t => t.id !== id));
    setNotifications(prev => [
      { id: `n-${Date.now()}`, title: 'Ticket Resolved', message: `Ticket ${id} has been marked as resolved.`, time: 'Just now', read: false, type: 'ticket' },
      ...prev,
    ]);
    // #19: Clean up state maps for resolved ticket
    setAutoReplyPausedTickets(prev => { const n = { ...prev }; delete n[id]; return n; });
    setAutoReplyHandedOffState(prev => { const n = { ...prev }; delete n[id]; return n; });
    setAutoReplyProcessingState(prev => { const n = { ...prev }; delete n[id]; return n; });
    setDraftRepliesState(prev => { const n = { ...prev }; delete n[id]; return n; });
  }, []);

  const addMessageToTicket = useCallback((ticketId: string, text: string) => {
    const now = Date.now();
    setTickets(prev => prev.map(t => {
      if (t.id !== ticketId) return t;
      const maxId = t.messages.length > 0 ? Math.max(...t.messages.map(m => m.id)) : 0;
      const newMsg: Message = {
        id: maxId + 1,
        sender: 'agent' as const,
        text,
        time: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        createdAt: now,
      };
      return { ...t, messages: [...t.messages, newMsg] };
    }));
    // #2: Proactively clear handedOff when agent replies
    setAutoReplyHandedOff(ticketId, false);
  }, [setAutoReplyHandedOff]);

  const injectGuestMessage = useCallback((ticketId: string, text: string, isGuestModeFlag = false) => {
    const now = Date.now();
    setTickets(prev => prev.map(t => {
      if (t.id !== ticketId) return t;
      const maxId = t.messages.length > 0 ? Math.max(...t.messages.map(m => m.id)) : 0;
      const newMsg: Message = {
        id: maxId + 1,
        sender: 'guest' as const,
        text,
        time: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        createdAt: now,
        isGuestMode: isGuestModeFlag || undefined, // #7: flag test messages so AI skips them
      };
      return { ...t, messages: [...t.messages, newMsg] };
    }));
  }, []);

  const addBotMessage = useCallback((ticketId: string, text: string) => {
    const now = Date.now();
    setTickets(prev => prev.map(t => {
      if (t.id !== ticketId) return t;
      const maxId = t.messages.length > 0 ? Math.max(...t.messages.map(m => m.id)) : 0;
      const newMsg: Message = {
        id: maxId + 1, sender: 'bot' as const, text,
        time: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        createdAt: now,
      };
      return { ...t, messages: [...t.messages, newMsg] };
    }));
  }, []);

  const addSystemMessage = useCallback((ticketId: string, text: string) => {
    const now = Date.now();
    setTickets(prev => prev.map(t => {
      if (t.id !== ticketId) return t;
      const maxId = t.messages.length > 0 ? Math.max(...t.messages.map(m => m.id)) : 0;
      const newMsg: Message = {
        id: maxId + 1, sender: 'system' as const, text,
        time: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        createdAt: now,
      };
      return { ...t, messages: [...t.messages, newMsg] };
    }));
  }, []);

  const addMultipleMessages = useCallback((ticketId: string, messages: { sender: Message['sender']; text: string }[]) => {
    const now = Date.now();
    setTickets(prev => prev.map(t => {
      if (t.id !== ticketId) return t;
      const maxId = t.messages.length > 0 ? Math.max(...t.messages.map(m => m.id)) : 0;
      const newMsgs: Message[] = messages.map((m, i) => ({
        id: maxId + 1 + i, sender: m.sender, text: m.text,
        time: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        createdAt: now,
      }));
      return { ...t, messages: [...t.messages, ...newMsgs] };
    }));
  }, []);

  const escalateTicketStatus = useCallback((ticketId: string) => {
    setTickets(prev => prev.map(t => {
      if (t.id !== ticketId) return t;
      if (t.status === 'normal') {
        return { ...t, status: 'warning' as const, sla: '12h' };
      }
      return t;
    }));
  }, []);

  const escalateTicketWithUrgency = useCallback((ticketId: string, level: 'warning' | 'urgent', sla: string) => {
    const now = Date.now();
    setTickets(prev => prev.map(t => {
      if (t.id !== ticketId) return t;
      return { ...t, status: level, sla, slaSetAt: now }; // #8: track SLA set time
    }));
  }, []);

  // #12: De-escalation path — lets agent downgrade urgency back to normal
  const deescalateTicket = useCallback((ticketId: string) => {
    setTickets(prev => prev.map(t => {
      if (t.id !== ticketId) return t;
      return { ...t, status: 'normal' as const, sla: '24:00', slaSetAt: Date.now() };
    }));
  }, []);

  const deleteMessageFromTicket = useCallback((ticketId: string, messageId: number) => {
    setTickets(prev => prev.map(t => {
      if (t.id !== ticketId) return t;
      const newMessages = t.messages.filter(m => m.id !== messageId);
      return { ...t, messages: newMessages };
    }));
  }, []);

  const deleteThread = useCallback((ticketId: string) => {
    setTickets(prev => prev.filter(t => t.id !== ticketId));
    // #19: Clean up state maps for deleted ticket to prevent unbounded growth
    setAutoReplyPausedTickets(prev => { const n = { ...prev }; delete n[ticketId]; return n; });
    setAutoReplyHandedOffState(prev => { const n = { ...prev }; delete n[ticketId]; return n; });
    setAutoReplyProcessingState(prev => { const n = { ...prev }; delete n[ticketId]; return n; });
    setDraftRepliesState(prev => { const n = { ...prev }; delete n[ticketId]; return n; });
  }, []);

  const addTask = useCallback((task: Omit<Task, 'id'>) => {
    const newTask: Task = { ...task, id: `tsk-${Date.now()}` };
    setTasks(prev => [newTask, ...prev]);
    setNotifications(prev => [
      { id: `n-${Date.now()}`, title: 'Task Created', message: `New task: ${task.title}`, time: 'Just now', read: false, type: 'task' },
      ...prev,
    ]);
  }, []);

  const updateTaskStatus = useCallback((id: string, status: Task['status']) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t));
  }, []);

  const deleteTask = useCallback((id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
  }, []);

  const addKBEntry = useCallback((entry: Omit<KBEntry, 'id'>) => {
    const newEntry: KBEntry = { ...entry, tags: entry.tags || [], id: Date.now() };
    setKbEntries(prev => [...prev, newEntry]);
  }, []);

  const updateKBEntry = useCallback((id: number, updates: Partial<KBEntry>) => {
    setKbEntries(prev => prev.map(kb => kb.id === id ? { ...kb, ...updates } : kb));
  }, []);

  const deleteKBEntry = useCallback((id: number) => {
    setKbEntries(prev => prev.filter(kb => kb.id !== id));
  }, []);

  const deleteKBEntriesBySource = useCallback((propId: string, source: 'onboarding' | 'manual') => {
    setKbEntries(prev => prev.filter(kb => !(kb.source === source && kb.propId === propId)));
  }, []);

  const markNotificationRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const updateHostSettings = useCallback((hostId: string, updates: Partial<HostSettings>) => {
    setHostSettings(prev => {
      const exists = prev.some(s => s.hostId === hostId);
      const next = exists
        ? prev.map(s => s.hostId === hostId ? { ...s, ...updates } : s)
        : [...prev, { hostId, tone: 'professional', autoReply: false, autoReplyMode: 'auto' as const, partialCoverage: 'answer-and-escalate', zeroCoverage: 'holding-message', cooldownEnabled: false, cooldownMinutes: 10, debouncePreset: 'instant', safetyKeywords: [...DEFAULT_SAFETY_KEYWORDS], activeHours: { enabled: false, startHour: 9, endHour: 21, displayHours: '9am–9pm daily' }, ...updates }];
      syncPrefToBackend('hostSettings', next);
      return next;
    });
  }, [syncPrefToBackend]);

  const addProperty = useCallback((prop: Property) => {
    setProperties(prev => [...prev, prop]);
    // Best-effort backend save
    (async () => {
      try {
        const { addProperty: addPropApi } = await getApiClient();
        await addPropApi(prop);
      } catch (err) {
        console.error('Failed to persist property to backend:', err);
      }
    })();
  }, []);

  const updatePropertyStatus = useCallback((id: string, status: Property['status']) => {
    setProperties(prev => prev.map(p => p.id === id ? { ...p, status } : p));
    // Best-effort backend save
    (async () => {
      try {
        const { updatePropertyStatus: updatePropApi } = await getApiClient();
        await updatePropApi(id, status);
      } catch (err) {
        console.error('Failed to update property status in backend:', err);
      }
    })();
  }, []);

  const updatePropertyMeta = useCallback((id: string, updates: Partial<Property>) => {
    setProperties(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  }, []);

  const deleteProperty = useCallback((id: string) => {
    setProperties(prev => prev.filter(p => p.id !== id));
    // Best-effort backend save
    (async () => {
      try {
        const { deleteProperty: deletePropApi } = await getApiClient();
        await deletePropApi(id);
      } catch (err) {
        console.error('Failed to delete property from backend:', err);
      }
    })();
  }, []);

  const setOnboardingField = useCallback((propertyId: string, key: string, value: string) => {
    setOnboardingData(prev => ({
      ...prev,
      [propertyId]: {
        ...prev[propertyId],
        [key]: value,
      },
    }));
  }, []);

  const setOnboardingBulk = useCallback((propertyId: string, data: Record<string, string>) => {
    setOnboardingData(prev => ({
      ...prev,
      [propertyId]: {
        ...prev[propertyId],
        ...data,
      },
    }));
  }, []);

  // Persist onboardingData to localStorage so host portal changes survive AppProvider re-creation
  useEffect(() => {
    try { localStorage.setItem('onboardingData', JSON.stringify(onboardingData)); } catch {}
  }, [onboardingData]);


  const addCustomFormSection = useCallback((propertyId: string, title: string) => {
    const newSectionId = `sec-${Date.now()}`;
    setCustomFormSections(prev => ({
      ...prev,
      [propertyId]: [
        ...(prev[propertyId] || []),
        { id: newSectionId, title },
      ],
    }));
    return newSectionId;
  }, []);

  const removeCustomFormSection = useCallback((propertyId: string, sectionId: string) => {
    setCustomFormSections(prev => ({
      ...prev,
      [propertyId]: (prev[propertyId] || []).filter(s => s.id !== sectionId),
    }));
  }, []);

  const renameCustomFormSection = useCallback((propertyId: string, sectionId: string, title: string) => {
    setCustomFormSections(prev => ({
      ...prev,
      [propertyId]: (prev[propertyId] || []).map(s => s.id === sectionId ? { ...s, title } : s),
    }));
  }, []);

  const updateFormSection = useCallback((sectionId: string, updates: Partial<OnboardingSection>) => {
    setFormTemplate(prev => prev.map(s => s.id === sectionId ? { ...s, ...updates } : s));
  }, []);

  const addFormSection = useCallback((section: OnboardingSection) => {
    setFormTemplate(prev => [...prev, section]);
  }, []);

  const removeFormSection = useCallback((sectionId: string) => {
    setFormTemplate(prev => prev.filter(s => s.id !== sectionId));
  }, []);

  const reorderFormSections = useCallback((fromIndex: number, toIndex: number) => {
    setFormTemplate(prev => {
      const result = [...prev];
      const [removed] = result.splice(fromIndex, 1);
      result.splice(toIndex, 0, removed);
      return result;
    });
  }, []);

  const updateFormField = useCallback((sectionId: string, fieldId: string, updates: Partial<OnboardingField>) => {
    setFormTemplate(prev => prev.map(s => s.id === sectionId ? {
      ...s,
      fields: s.fields.map(f => f.id === fieldId ? { ...f, ...updates } : f),
    } : s));
  }, []);

  const addFormField = useCallback((sectionId: string, field: OnboardingField) => {
    setFormTemplate(prev => prev.map(s => s.id === sectionId ? {
      ...s,
      fields: [...s.fields, field],
    } : s));
  }, []);

  const removeFormField = useCallback((sectionId: string, fieldId: string) => {
    setFormTemplate(prev => prev.map(s => s.id === sectionId ? {
      ...s,
      fields: s.fields.filter(f => f.id !== fieldId),
    } : s));
  }, []);

  const reorderFormFields = useCallback((sectionId: string, fromIndex: number, toIndex: number) => {
    setFormTemplate(prev => prev.map(s => {
      if (s.id !== sectionId) return s;
      const fields = [...s.fields];
      const [removed] = fields.splice(fromIndex, 1);
      fields.splice(toIndex, 0, removed);
      return { ...s, fields };
    }));
  }, []);

  const resetFormTemplate = useCallback(() => {
    setFormTemplate(STATIC_SECTIONS);
  }, []);

  const addFormPhase = useCallback((phase: FormPhase) => {
    setFormPhases(prev => [...prev, phase]);
  }, []);

  const updateFormPhase = useCallback((id: number, updates: Partial<Omit<FormPhase, 'id'>>) => {
    setFormPhases(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  }, []);

  const removeFormPhase = useCallback((id: number) => {
    setFormPhases(prev => prev.filter(p => p.id !== id));
  }, []);

  const reorderFormPhases = useCallback((fromIndex: number, toIndex: number) => {
    setFormPhases(prev => {
      const result = [...prev];
      const [removed] = result.splice(fromIndex, 1);
      result.splice(toIndex, 0, removed);
      return result;
    });
  }, []);

  const resetFormPhases = useCallback(() => {
    setFormPhases(DEFAULT_PHASES);
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  // ─── Load onboarding data from Supabase on startup ──────────────────────────
  useEffect(() => {
    const propIds = properties.map(p => p.id).join(',');
    if (!propIds) return;

    (async () => {
      try {
        const res = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-ab702ee0/onboarding/load?propIds=${encodeURIComponent(propIds)}`,
          { headers: { 'Authorization': `Bearer ${publicAnonKey}`, 'Content-Type': 'application/json' } }
        );
        if (!res.ok) return;
        const { data } = await res.json();
        if (!data || typeof data !== 'object') return;

        const entries = Object.entries(data) as [string, Record<string, string>][];
        if (entries.length === 0) return;

        // Merge server data into onboarding state (server wins), then recompose KB
        setOnboardingData(prev => {
          const merged = { ...prev };
          for (const [propId, formData] of entries) {
            merged[propId] = { ...(prev[propId] || {}), ...formData };
          }
          return merged;
        });

        console.log(`[KB Sync] ✓ Loaded onboarding from Supabase for ${entries.length} properties`);
      } catch (err) {
        console.log('[KB Sync] Supabase load skipped (offline or no data):', err);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  // ─── Auto-persist manual KB entries when they change ────────────────────────
  useEffect(() => {
    if (kbEntries.length === 0) return;

    const persistKBToDB = () => {
      try {
        localStorage.setItem('kb_entries_all', JSON.stringify(kbEntries));
        console.log(`[KB Persist] ✓ Saved ${kbEntries.length} entries to localStorage`);
      } catch (err) {
        console.log('[KB Persist] localStorage failed:', err);
      }
    };

    // Debounce persist by 500ms to avoid excessive saves during rapid form edits
    const timer = setTimeout(() => {
      persistKBToDB();
    }, 500);

    return () => clearTimeout(timer);
  }, [kbEntries]);

  // ─── Manual sync to Supabase ─────────────────────────────────
  const manualSyncFormData = useCallback(async () => {
    const data = onboardingDataRef.current;
    if (Object.keys(data).length === 0) return;

    setFormPersistStatus('syncing');

    try {
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-ab702ee0/onboarding/save`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${publicAnonKey}`,
          },
          body: JSON.stringify(data),
        }
      );

      if (!response.ok) {
        throw new Error(`Sync failed: ${response.status}`);
      }

      setFormPersistStatus('server');
    } catch (error) {
      console.error('[Sync] Error:', error);
      setFormPersistStatus('local');
    }
  }, []); // stable — reads latest data via ref

  // ─── Auto-save onboarding form data to Supabase (debounced 2s) ──────────────
  // Fires on every form change from any touchpoint (OnboardingView, HostPortalView, etc.)
  useEffect(() => {
    if (Object.keys(onboardingData).length === 0) return;
    setFormPersistStatus('syncing');
    const timer = setTimeout(() => manualSyncFormData(), 2000);
    return () => clearTimeout(timer);
  }, [onboardingData]); // eslint-disable-line react-hooks/exhaustive-deps

  const [aiSettingsLoading, setAiSettingsLoading] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [maskedApiKey, setMaskedApiKey] = useState('');

  const refreshAISettings = useCallback(async () => {
    setAiSettingsLoading(true);
    try {
      const { getAISettings } = await getApiClient();
      const settings = await getAISettings();
      setHasApiKey(settings.hasApiKey);
      setMaskedApiKey(settings.maskedApiKey);
      setAiModelRaw(settings.model || 'openai/gpt-4o-mini');
      try { localStorage.setItem('aiModel', settings.model || 'openai/gpt-4o-mini'); } catch {}
    } catch (err) {
      console.error('Failed to fetch AI settings:', err);
    } finally {
      setAiSettingsLoading(false);
    }
  }, []);

  const saveAIApiKey = useCallback(async (key: string) => {
    setAiSettingsLoading(true);
    try {
      // Save to localStorage for client-side use (e.g., document import)
      setOpenRouterApiKey(key);

      const { saveAISettings } = await getApiClient();
      const settings = await saveAISettings({ apiKey: key });
      setHasApiKey(settings.hasApiKey);
      setMaskedApiKey(settings.maskedApiKey);
    } catch (err) {
      console.error('Failed to save AI API key:', err);
      throw err;
    } finally {
      setAiSettingsLoading(false);
    }
  }, [setOpenRouterApiKey]);

  const saveAIModel = useCallback(async (model: string) => {
    setAiSettingsLoading(true);
    try {
      const { saveAISettings } = await getApiClient();
      const settings = await saveAISettings({ model });
      setAiModelRaw(settings.model);
      try { localStorage.setItem('aiModel', settings.model); } catch {}
    } catch (err) {
      console.error('Failed to save AI model:', err);
      throw err;
    } finally {
      setAiSettingsLoading(false);
    }
  }, []);

  const saveImportAiModel = useCallback(async (model: string) => {
    setImportAiModel(model);
  }, [setImportAiModel]);

  const clearAIApiKey = useCallback(async () => {
    setAiSettingsLoading(true);
    try {
      const { clearAIKey } = await getApiClient();
      const settings = await clearAIKey();
      setHasApiKey(settings.hasApiKey);
      setMaskedApiKey(settings.maskedApiKey);
    } catch (err) {
      console.error('Failed to clear AI API key:', err);
      throw err;
    } finally {
      setAiSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshAISettings();
  }, [refreshAISettings]);


  const resetToDemo = useCallback(() => {
    setActiveHostFilter('all');
    skipNextTicketSaveRef.current = true;
    setTickets(MOCK_TICKETS);
    setTasks(INITIAL_TASKS);
    setKbEntries(MOCK_KB);
    setDarkModeRaw(false);
    setDevModeRaw(false);
    setAgentNameRaw('Agent Felix');
    setDefaultLanguageRaw('en');
    setOpenRouterApiKeyRaw('');
    setAiModelRaw('openai/gpt-4o-mini');
    setNotifications([
      { id: 'n1', title: 'New Escalation', message: 'Elena Rodriguez - AC issue at Villa Azure escalated by AI', time: '2 min ago', read: false, type: 'ticket' },
      { id: 'n2', title: 'Task Overdue', message: 'Mid-stay Cleaning for Shinjuku Lofts 402 is approaching deadline', time: '15 min ago', read: false, type: 'task' },
      { id: 'n3', title: 'Knowledge Base Updated', message: 'Urban Stays Co. luggage policy was modified by Admin', time: '1 hr ago', read: true, type: 'system' },
    ]);
    const resetHostSettings = MOCK_HOSTS.map(h => makeDefaultHostSettings(h));
    setHostSettings(resetHostSettings);
    setProperties(MOCK_PROPERTIES);
    setOnboardingData(PREFILLED_ONBOARDING);
    setCustomFormSections({});
    setDraftRepliesState({});
    setAutoReplyPausedTickets({});
    setAutoReplyHandedOffState({});
    setAutoReplyProcessingState({});
    setFormTemplateRaw(STATIC_SECTIONS);
    setFormPhasesRaw(DEFAULT_PHASES);
    // Clear persisted data
    try {
      localStorage.removeItem('formTemplate');
      localStorage.removeItem('formPhases');
      localStorage.removeItem('openRouterApiKey');
      localStorage.removeItem('aiModel');
      localStorage.removeItem('autoReplyPausedTickets');
      localStorage.removeItem('autoReplyHandedOff');
      localStorage.removeItem('draftReplies');
      localStorage.removeItem('onboardingData');
    } catch {}
    // Clear AI debug log
    clearDebugEntries();
    // Clear persisted state from BE (including hostSettings so reload doesn't restore old values)
    getApiClient().then(({ savePreferences }) => {
      savePreferences({ ticketState: '', hostSettings: resetHostSettings, properties: MOCK_PROPERTIES }).catch(() => {});
    }).catch(() => {});
  }, []);

  // ─── Ticket persistence to BE ─────────────────────────────
  const ticketSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ticketsLoadedRef = useRef(false);
  const skipNextTicketSaveRef = useRef(false);

  // Serialize only the mutable parts of tickets (messages + resolved IDs)
  const saveTicketState = useCallback((currentTickets: Ticket[]) => {
    if (ticketSaveTimeoutRef.current) clearTimeout(ticketSaveTimeoutRef.current);
    ticketSaveTimeoutRef.current = setTimeout(async () => {
      try {
        const mockIds = new Set(MOCK_TICKETS.map(mt => mt.id));
        const messages: Record<string, any[]> = {};
        for (const t of currentTickets) {
          messages[t.id] = t.messages;
        }
        const resolvedIds = MOCK_TICKETS
          .filter(mt => !currentTickets.find(ct => ct.id === mt.id))
          .map(mt => mt.id);
        // Persist custom (test) tickets separately — strip non-serializable fields
        const customTickets = currentTickets
          .filter(t => !mockIds.has(t.id))
          .map(({ channelIcon, ...rest }) => rest);
        const { savePreferences } = await getApiClient();
        await savePreferences({ ticketState: JSON.stringify({ messages, resolvedIds, customTickets }) });
      } catch (err) {
        console.error('Failed to persist ticket state:', err);
      }
    }, 500);
  }, []);

  // Save tickets whenever they change (after initial load)
  useEffect(() => {
    if (!ticketsLoadedRef.current) return;
    if (skipNextTicketSaveRef.current) {
      skipNextTicketSaveRef.current = false;
      return;
    }
    saveTicketState(tickets);
  }, [tickets, saveTicketState]);

  const createTestTicket = useCallback((opts: { hostId: string; propertyName: string; guestName: string; firstMessage: string }) => {
    const host = MOCK_HOSTS.find(h => h.id === opts.hostId) || MOCK_HOSTS[0];
    const prop = MOCK_PROPERTIES.find(p => p.name === opts.propertyName && p.hostId === host.id);
    const room = prop?.roomNames?.[0] || 'Entire Property';
    const ticketId = `t-${Date.now()}`;

    // Derive realistic tags + handover reason from the guest's first message
    const detected = detectInquiries([opts.firstMessage], [], '');
    const primaryInquiry = detected[0];

    // Build handover reason in the same style as mock data: "Category (Detail)"
    const HANDOVER_MAP: Record<string, string> = {
      maintenance: 'Maintenance Request',
      wifi: 'Wi-Fi Connectivity Issue',
      checkout: 'Schedule Change Request (Late Checkout)',
      checkin: 'Early Check-in / Access Inquiry',
      noise: 'Noise Complaint (Guest Report)',
      luggage: 'Complex Inquiry (Luggage)',
      directions: 'Pre-arrival Inquiry (Transport)',
      billing: 'Billing / Refund Inquiry',
      amenities: 'Amenity Inquiry',
      pet: 'Pet Policy Inquiry',
      safety: 'Safety / Emergency Concern',
    };

    let handoverReason: string;
    let tags: string[];
    let summary: string;
    let status: 'normal' | 'urgent' | 'warning' = 'normal';

    if (primaryInquiry && primaryInquiry.type !== 'general') {
      handoverReason = HANDOVER_MAP[primaryInquiry.type] || `${primaryInquiry.label}`;
      // Append detail if it adds context
      if (primaryInquiry.detail && !handoverReason.includes(primaryInquiry.detail)) {
        const shortDetail = primaryInquiry.detail.length > 40
          ? primaryInquiry.detail.slice(0, 37) + '...'
          : primaryInquiry.detail;
        handoverReason += ` — ${shortDetail}`;
      }
      // Use the inquiry's tags directly
      tags = [...new Set(primaryInquiry.relevantTags)];
      // If multiple inquiries detected, note that
      if (detected.length > 1) {
        handoverReason = `Multi-topic: ${detected.map(d => d.label.split(' ')[0]).join(' + ')}`;
        tags = [...new Set(detected.flatMap(d => d.relevantTags))];
      }
      summary = `${opts.guestName}: ${primaryInquiry.detail}`;
      // Escalate maintenance, safety, and noise
      if (['maintenance', 'safety'].includes(primaryInquiry.type)) {
        status = 'urgent';
        if (!tags.includes('High Priority')) tags.push('High Priority');
      } else if (['noise', 'billing'].includes(primaryInquiry.type)) {
        status = 'warning';
      }
    } else {
      // General / unclassifiable — still give it a reasonable handover
      handoverReason = 'Guest Inquiry (Needs Review)';
      tags = ['Needs Review'];
      summary = `${opts.guestName} sent a message that needs agent review.`;
    }

    const newTicket: Ticket = {
      id: ticketId,
      guestName: opts.guestName,
      channel: 'Direct',
      channelIcon: MessageSquare,
      host,
      property: opts.propertyName,
      room,
      status,
      sla: status === 'urgent' ? '04:00' : status === 'warning' ? '12:00' : '24:00',
      aiHandoverReason: handoverReason,
      summary,
      tags,
      language: 'English',
      messages: [
        {
          id: 1,
          sender: 'guest' as const,
          text: opts.firstMessage,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          createdAt: Date.now(),
        },
      ],
      booking: { checkIn: 'Today', checkOut: 'Tomorrow', guests: 2, status: 'Checked In' },
    };
    setTickets(prev => [newTicket, ...prev]);
    return ticketId;
  }, []);

  const resumeAllAI = useCallback(() => {
    setAutoReplyPausedTickets({});
    // Must explicitly set each ticket to `false` (not just `{}`) so that
    // the `=== false` override check in InboxView/useAutoReply prevents
    // system-message-derived "handed off" status from re-asserting.
    const allFalse: Record<string, boolean> = {};
    for (const t of tickets) {
      allFalse[t.id] = false;
    }
    setAutoReplyHandedOffState(allFalse);
  }, [tickets]);

  return (
    <AppContext.Provider value={{
      activeHostFilter, setActiveHostFilter,
      tickets, resolveTicket, addMessageToTicket, injectGuestMessage, addBotMessage, addSystemMessage, addMultipleMessages, escalateTicketStatus, escalateTicketWithUrgency, deescalateTicket, deleteMessageFromTicket, deleteThread,
      draftReplies, setDraftReply, clearDraftReply,
      tasks, setTasks, addTask, updateTaskStatus, deleteTask,
      kbEntries, addKBEntry, updateKBEntry, deleteKBEntry, deleteKBEntriesBySource,
      properties, addProperty, updatePropertyStatus, updatePropertyMeta, deleteProperty,
      onboardingData, setOnboardingField, setOnboardingBulk,
      formPersistStatus, manualSyncFormData,
      customFormSections, addCustomFormSection, removeCustomFormSection, renameCustomFormSection,
      notifications, markNotificationRead, markAllNotificationsRead, unreadCount,
      hostSettings, updateHostSettings,
      darkMode, setDarkMode,
      devMode: devModeRaw, setDevMode,
      agentName: agentNameRaw, setAgentName,
      defaultLanguage: defaultLanguageRaw, setDefaultLanguage,
      openRouterApiKey, setOpenRouterApiKey,
      aiModel, setAiModel,
      importAiModel, setImportAiModel,
      formTemplate, updateFormSection, addFormSection, removeFormSection, reorderFormSections,
      updateFormField, addFormField, removeFormField, reorderFormFields,
      resetFormTemplate,
      formPhases, addFormPhase, updateFormPhase, removeFormPhase, reorderFormPhases,
      resetFormPhases,
      aiSettingsLoading,
      hasApiKey,
      maskedApiKey,
      saveAIApiKey,
      saveAIModel,
      saveImportAiModel,
      clearAIApiKey,
      refreshAISettings,
      resetToDemo,
      createTestTicket,
      notificationPrefs, updateNotificationPrefs,
      autoReplyProcessing, setAutoReplyProcessing,
      autoReplyCancelledRef,
      autoReplyAbortControllers,
      cancelAutoReply,
      autoReplyPausedTickets, toggleAutoReplyPause,
      autoReplyHandedOff, setAutoReplyHandedOff,
      resumeAllAI,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
}