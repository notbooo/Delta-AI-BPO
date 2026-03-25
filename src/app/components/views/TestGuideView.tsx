import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router';
import {
  MessageSquare, Bot, Zap, FileText, ClipboardList,
  ChevronDown, ChevronRight, Check, Copy, ExternalLink,
  ArrowLeft, Sparkles, Play, Eye, ToggleLeft, PenLine,
  Send, Users, Building, Link2, HelpCircle, Shield,
  BookOpen, TestTube2
} from 'lucide-react';
import { toast } from 'sonner';
import { useAppContext } from '../../context/AppContext';
import { MOCK_HOSTS } from '../../data/mock-data';

interface TestStep {
  action: string;
  expect: string;
}

interface TestScenario {
  id: string;
  title: string;
  icon: React.ReactNode;
  area: string;
  prereqs?: string;
  steps: TestStep[];
  tips?: string;
}

const TEST_SCENARIOS: TestScenario[] = [
  {
    id: 'guest-chat',
    title: 'Chat as a Guest',
    icon: <MessageSquare size={18} />,
    area: 'Inbox',
    steps: [
      { action: 'Go to Inbox and open a ticket (e.g. Elena Rodriguez)', expect: 'Conversation loads with message history in center panel' },
      { action: 'Type a guest-style message in the reply box and send', expect: 'Message appears in thread. If auto-reply is ON, AI responds within a few seconds' },
      { action: 'Try asking something covered in articles (e.g. "What\'s the Wi-Fi password?")', expect: 'AI auto-reply answers accurately using knowledge base data' },
      { action: 'Try asking something NOT covered (e.g. "Can I bring my pet iguana?")', expect: 'AI sends a holding message and hands off to agent with an explanation' },
    ],
    tips: 'Look at the system messages (gray pills) to see AI reasoning — they explain why it auto-replied vs. escalated.',
  },
  {
    id: 'auto-reply-toggle',
    title: 'Auto-Reply: ON vs OFF',
    icon: <Bot size={18} />,
    area: 'Inbox + Settings',
    steps: [
      { action: 'Go to Settings > AI & Automation', expect: 'You see the Auto-Reply master toggle and per-property controls' },
      { action: 'Toggle Auto-Reply OFF globally', expect: 'The "AI Auto-Reply" badge in Inbox header turns OFF / disappears' },
      { action: 'Send a guest message in any ticket', expect: 'No AI response — message just sits waiting for agent' },
      { action: 'Toggle Auto-Reply back ON', expect: 'AI badge reappears. New incoming messages will get AI responses' },
      { action: 'Send another guest message', expect: 'AI analyzes and responds (or escalates) automatically' },
    ],
    tips: 'You can also toggle per-property in Settings. The inbox header shows the current auto-reply state for the selected ticket\'s property.',
  },
  {
    id: 'smart-reply',
    title: 'Smart Reply (Agent-Assisted)',
    icon: <Zap size={18} />,
    area: 'Inbox',
    steps: [
      { action: 'Open a ticket that has been handed to agent (look for "Handed to Agent" system message)', expect: 'Smart Reply panel appears below the conversation' },
      { action: 'Review the AI-composed draft — it shows which topics are covered vs. not', expect: 'Green chips = covered by articles, amber chips = not covered' },
      { action: 'Click on an uncovered topic chip to add your own answer', expect: 'Text field opens — type your response for that specific topic' },
      { action: 'Edit the composed draft text if needed', expect: 'Draft updates. You can freely edit before sending' },
      { action: 'Click "Send Reply"', expect: 'Message sends to guest. A toast may suggest adding uncovered topics to articles' },
    ],
    tips: 'Smart Reply only activates when there are guest questions to answer. It won\'t show for simple "thank you" messages.',
  },
  {
    id: 'ask-ai',
    title: 'Ask AI (Context Panel)',
    icon: <Sparkles size={18} />,
    area: 'Inbox',
    prereqs: 'Have the right context pane open (click the AI/sparkle button in inbox toolbar)',
    steps: [
      { action: 'Open a ticket and look at the right-side context panel', expect: 'You see guest info, booking details, and AI Assistant tab' },
      { action: 'Switch to the "AI Assistant" tab if not already selected', expect: 'Shows article matches for current conversation topics' },
      { action: 'Type a question in the "Ask AI" box at the bottom (e.g. "What\'s the checkout time for Villa Azure?")', expect: 'AI responds using knowledge base context for that property' },
      { action: 'Ask about something not in articles', expect: 'AI tells you it doesn\'t have that info and suggests adding an article' },
    ],
  },
  {
    id: 'articles',
    title: 'Browse & Check Articles',
    icon: <FileText size={18} />,
    area: 'Articles',
    steps: [
      { action: 'Click "Articles" in the sidebar navigation', expect: 'Property list with card for each property and article counts' },
      { action: 'Click on a property (e.g. Villa Azure)', expect: 'Full article list grouped by source — shows all AI knowledge for that property' },
      { action: 'Click an article to expand it', expect: 'Full content visible. Tags, scope (property/room), and source shown' },
      { action: 'Try the search/filter at the top', expect: 'Articles filter by title, content, or tags in real-time' },
      { action: 'Check "Source: onboarding" articles', expect: 'These were auto-generated from the onboarding form data' },
    ],
    tips: 'Articles with "onboarding" source auto-update when the host form is edited. Manual articles are independent.',
  },
  {
    id: 'host-form',
    title: 'Fill Form as a Host (Shareable Link)',
    icon: <ClipboardList size={18} />,
    area: 'Host Portal',
    prereqs: 'Need a portal link — get it from Articles > Property > "Copy Portal Link"',
    steps: [
      { action: 'Get a host portal link: Go to Articles > click a property > find the portal/share link', expect: 'A URL like /host/p1/va-portal-abc123 is copied' },
      { action: 'Open the link (paste in browser or new tab)', expect: 'Mobile-friendly form loads with property name and progress bar' },
      { action: 'Fill in a few fields (e.g. update the Wi-Fi password)', expect: 'Auto-save indicator shows "Saving..." then "Saved"' },
      { action: 'Navigate between sections using bottom arrows or the section picker dropdown', expect: 'Smooth transitions, progress tracked per-section' },
      { action: 'After editing, go back to Articles and check the property', expect: 'Article content reflects the updated form data (auto-synced)' },
    ],
    tips: 'The form is mobile-first — try it on your phone! For active properties, changes auto-sync to AI articles in real-time.',
  },
  {
    id: 'onboarding-internal',
    title: 'Onboarding Form (Internal View)',
    icon: <Building size={18} />,
    area: 'Articles > Onboarding',
    steps: [
      { action: 'Go to Articles and find "Tahoe Cabins" (status: Onboarding)', expect: 'Shows setup/onboarding badge' },
      { action: 'Click "Continue Setup" or the onboarding link', expect: 'Full internal onboarding form with all sections and fields' },
      { action: 'Fill required Phase 1 fields (basics, access, Wi-Fi, emergency)', expect: 'Section checkmarks appear, progress bar fills' },
      { action: 'When Phase 1 is complete, click "Go Live"', expect: 'Property switches to Active. Articles are generated and AI is ready' },
      { action: 'Make an edit after going live', expect: 'Auto-sync indicator shows "Synced" — articles update automatically' },
    ],
    tips: 'Internal view shows fields marked "Ops only" that hosts can\'t see. The host portal filters these out.',
  },
];

function StepRow({ step, index, done, onToggle }: { step: TestStep; index: number; done: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`w-full text-left flex gap-3 p-3 rounded-xl transition-colors ${done ? 'bg-green-50/60' : 'hover:bg-slate-50 active:bg-slate-100'}`}
    >
      <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
        done ? 'bg-green-500 border-green-500 text-white' : 'border-slate-300'
      }`}>
        {done ? <Check size={12} /> : <span className="text-[10px] font-bold text-slate-400">{index + 1}</span>}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm leading-snug ${done ? 'text-slate-400 line-through' : 'text-slate-700 font-medium'}`}>
          {step.action}
        </p>
        <p className="text-[11px] text-slate-400 mt-1 leading-relaxed flex items-start gap-1">
          <Eye size={10} className="shrink-0 mt-0.5" />
          {step.expect}
        </p>
      </div>
    </button>
  );
}

export function TestGuideView() {
  const navigate = useNavigate();
  const { properties } = useAppContext();
  const [expandedScenario, setExpandedScenario] = useState<string | null>('guest-chat');
  const [completedSteps, setCompletedSteps] = useState<Record<string, boolean[]>>({});

  const toggleStep = (scenarioId: string, stepIdx: number, totalSteps: number) => {
    setCompletedSteps(prev => {
      const arr = prev[scenarioId] || new Array(totalSteps).fill(false);
      const next = [...arr];
      next[stepIdx] = !next[stepIdx];
      return { ...prev, [scenarioId]: next };
    });
  };

  const getScenarioProgress = (scenarioId: string, totalSteps: number) => {
    const arr = completedSteps[scenarioId] || [];
    const done = arr.filter(Boolean).length;
    return { done, total: totalSteps, pct: totalSteps > 0 ? Math.round((done / totalSteps) * 100) : 0 };
  };

  const overallProgress = useMemo(() => {
    let done = 0;
    let total = 0;
    for (const s of TEST_SCENARIOS) {
      total += s.steps.length;
      const arr = completedSteps[s.id] || [];
      done += arr.filter(Boolean).length;
    }
    return total > 0 ? Math.round((done / total) * 100) : 0;
  }, [completedSteps]);

  // Build portal links for quick copy
  const portalLinks = useMemo(() => {
    const links: { name: string; url: string; type: 'external' | 'internal' }[] = [];
    for (const p of properties) {
      if (p.status === 'Active') {
        if (p.portalToken) {
          links.push({
            name: p.name,
            url: `${window.location.origin}/host/${p.id}/${p.portalToken}`,
            type: 'external',
          });
        }
        if (p.internalPortalToken) {
          links.push({
            name: `${p.name} (Internal)`,
            url: `${window.location.origin}/host/${p.id}/${p.internalPortalToken}`,
            type: 'internal',
          });
        }
      }
    }
    return links;
  }, [properties]);

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-50 h-full overflow-hidden animate-in fade-in duration-200">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 shrink-0 shadow-sm">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => navigate('/inbox')} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors text-slate-400 hover:text-slate-700">
            <ArrowLeft size={18} />
          </button>
          <div className="p-2 bg-indigo-100 rounded-xl">
            <TestTube2 size={20} className="text-indigo-600" />
          </div>
          <div>
            <h1 className="font-bold text-slate-800 text-lg">Test Guide</h1>
            <p className="text-xs text-slate-500">Internal PR FAQ & QA walkthrough for stakeholders</p>
          </div>
        </div>

        {/* Overall progress */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${overallProgress === 100 ? 'bg-green-500' : 'bg-indigo-500'}`}
              style={{ width: `${overallProgress}%` }}
            />
          </div>
          <span className={`text-xs font-bold ${overallProgress === 100 ? 'text-green-600' : 'text-slate-500'}`}>
            {overallProgress}%
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-4">

          {/* Quick Links */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Link2 size={12} /> Quick Links
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                onClick={() => navigate('/inbox')}
                className="flex items-center gap-2 px-3 py-2 text-sm text-left bg-slate-50 hover:bg-indigo-50 rounded-lg transition-colors group"
              >
                <MessageSquare size={14} className="text-slate-400 group-hover:text-indigo-500" />
                <span className="text-slate-600 group-hover:text-indigo-700 font-medium">Open Inbox</span>
              </button>
              <button
                onClick={() => navigate('/kb')}
                className="flex items-center gap-2 px-3 py-2 text-sm text-left bg-slate-50 hover:bg-indigo-50 rounded-lg transition-colors group"
              >
                <FileText size={14} className="text-slate-400 group-hover:text-indigo-500" />
                <span className="text-slate-600 group-hover:text-indigo-700 font-medium">Open Articles</span>
              </button>
              <button
                onClick={() => navigate('/settings/ai')}
                className="flex items-center gap-2 px-3 py-2 text-sm text-left bg-slate-50 hover:bg-indigo-50 rounded-lg transition-colors group"
              >
                <ToggleLeft size={14} className="text-slate-400 group-hover:text-indigo-500" />
                <span className="text-slate-600 group-hover:text-indigo-700 font-medium">AI Settings</span>
              </button>
              <button
                onClick={() => navigate('/settings')}
                className="flex items-center gap-2 px-3 py-2 text-sm text-left bg-slate-50 hover:bg-indigo-50 rounded-lg transition-colors group"
              >
                <Shield size={14} className="text-slate-400 group-hover:text-indigo-500" />
                <span className="text-slate-600 group-hover:text-indigo-700 font-medium">Settings</span>
              </button>
            </div>

            {/* Portal links */}
            {portalLinks.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Portal Links</h4>
                <div className="space-y-1.5">
                  {portalLinks.map(link => (
                    <div key={link.name} className="flex items-center gap-2 text-xs">
                      <span className={`px-2 py-0.5 rounded text-[9px] font-bold shrink-0 ${
                        link.type === 'internal'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-indigo-100 text-indigo-700'
                      }`}>
                        {link.type === 'internal' ? 'INTERNAL' : 'SHARED'}
                      </span>
                      <span className="font-medium text-slate-600 shrink-0 truncate">{link.name}:</span>
                      <code className="flex-1 text-[10px] bg-slate-50 px-2 py-1 rounded truncate text-slate-500 font-mono">{link.url}</code>
                      <button onClick={() => copyText(link.url, `${link.name} link`)} className="text-slate-400 hover:text-indigo-600 shrink-0">
                        <Copy size={12} />
                      </button>
                      <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-indigo-600 shrink-0">
                        <ExternalLink size={12} />
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* FAQ Section */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <HelpCircle size={12} /> PR FAQ
            </h3>
            <div className="space-y-3 text-sm">
              <div>
                <p className="font-semibold text-slate-700">What is this?</p>
                <p className="text-slate-500 mt-0.5 leading-relaxed text-xs">An AI-powered ops platform for hospitality customer success. It auto-replies to guest messages using property knowledge, escalates what it can't handle, and gives agents smart tools to respond faster.</p>
              </div>
              <div>
                <p className="font-semibold text-slate-700">How does Auto-Reply work?</p>
                <p className="text-slate-500 mt-0.5 leading-relaxed text-xs">When a guest sends a message, AI checks the property's articles. If it can answer confidently, it replies automatically. If not, it sends a holding message and hands off to an agent with context.</p>
              </div>
              <div>
                <p className="font-semibold text-slate-700">What's Smart Reply?</p>
                <p className="text-slate-500 mt-0.5 leading-relaxed text-xs">When AI escalates to an agent, Smart Reply pre-drafts a response using articles. The agent reviews, fills gaps for uncovered topics, edits if needed, and sends. It's agent-in-the-loop, not full automation.</p>
              </div>
              <div>
                <p className="font-semibold text-slate-700">How do articles get created?</p>
                <p className="text-slate-500 mt-0.5 leading-relaxed text-xs">Primarily through the onboarding form. When a host fills in property details, articles are auto-generated and vectorized. Agents can also manually add articles. Everything auto-syncs when forms are edited.</p>
              </div>
              <div>
                <p className="font-semibold text-slate-700">Can hosts update info themselves?</p>
                <p className="text-slate-500 mt-0.5 leading-relaxed text-xs">Yes. Each property has a shareable link. Hosts open it on their phone, edit fields, and changes auto-sync to AI articles in real-time. No training needed — it's a simple mobile form.</p>
              </div>
              <div>
                <p className="font-semibold text-slate-700">Is anything mocked?</p>
                <p className="text-slate-500 mt-0.5 leading-relaxed text-xs">Ticket data and guest messages are demo data. AI responses use real logic (or simulated with realistic delays if no API key is set). The form → article → AI pipeline is fully functional.</p>
              </div>
            </div>
          </div>

          {/* Test Scenarios */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 px-1">
              <Play size={12} /> Test Scenarios ({TEST_SCENARIOS.length})
            </h3>

            {TEST_SCENARIOS.map(scenario => {
              const isExpanded = expandedScenario === scenario.id;
              const progress = getScenarioProgress(scenario.id, scenario.steps.length);

              return (
                <div key={scenario.id} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                  <button
                    onClick={() => setExpandedScenario(isExpanded ? null : scenario.id)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 active:bg-slate-50 transition-colors"
                  >
                    <div className={`p-2 rounded-xl shrink-0 ${
                      progress.pct === 100 ? 'bg-green-50 text-green-600' :
                      isExpanded ? 'bg-indigo-50 text-indigo-600' :
                      'bg-slate-100 text-slate-400'
                    }`}>
                      {progress.pct === 100 ? <Check size={18} /> : scenario.icon}
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-bold ${progress.pct === 100 ? 'text-green-700' : 'text-slate-800'}`}>
                          {scenario.title}
                        </span>
                        <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">
                          {scenario.area}
                        </span>
                      </div>
                      {progress.done > 0 && (
                        <div className="flex items-center gap-2 mt-1">
                          <div className="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden max-w-[120px]">
                            <div className={`h-full rounded-full ${progress.pct === 100 ? 'bg-green-500' : 'bg-indigo-400'}`} style={{ width: `${progress.pct}%` }} />
                          </div>
                          <span className="text-[10px] text-slate-400">{progress.done}/{progress.total}</span>
                        </div>
                      )}
                    </div>
                    <ChevronDown size={16} className={`text-slate-400 transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-slate-100">
                      {scenario.prereqs && (
                        <div className="mt-3 mb-2 flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-100 rounded-lg">
                          <HelpCircle size={12} className="text-amber-500 shrink-0 mt-0.5" />
                          <p className="text-[11px] text-amber-700 leading-relaxed"><span className="font-bold">Prereq:</span> {scenario.prereqs}</p>
                        </div>
                      )}

                      <div className="mt-2 space-y-0.5">
                        {scenario.steps.map((step, idx) => (
                          <StepRow
                            key={idx}
                            step={step}
                            index={idx}
                            done={completedSteps[scenario.id]?.[idx] || false}
                            onToggle={() => toggleStep(scenario.id, idx, scenario.steps.length)}
                          />
                        ))}
                      </div>

                      {scenario.tips && (
                        <div className="mt-3 flex items-start gap-2 p-2.5 bg-blue-50 border border-blue-100 rounded-lg">
                          <Sparkles size={12} className="text-blue-500 shrink-0 mt-0.5" />
                          <p className="text-[11px] text-blue-700 leading-relaxed"><span className="font-bold">Tip:</span> {scenario.tips}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Bottom spacer */}
          <div className="h-8" />
        </div>
      </div>
    </div>
  );
}
