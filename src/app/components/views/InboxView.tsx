import { detectInquiries, scoreKBForInquiry } from '../inbox/InquiryDetector';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import {
  Clock, Send, User,
  Sparkles, CheckCircle, ChevronRight, ChevronDown, Briefcase,
  Building, Key, Bot, Users, Globe2, Tag, UserCircle, Home,
  Plus, X, Trash2, Copy, FileEdit, Info, ShieldAlert, ArrowRightLeft,
  Loader2, Square, PauseCircle, SkipForward, Zap, AlertCircle,
  ArrowLeft, PanelRightOpen, PanelRightClose, PanelLeftOpen, PanelLeftClose, ChevronsLeft, ChevronsRight,
  ArrowDown, MessageSquare as MessageSquareIcon, MoreVertical
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useAppContext } from '../../context/AppContext';
import { MOCK_HOSTS, MOCK_PROPERTIES } from '../../data/mock-data';
import { parseThreadStatus } from '../../data/types';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { AssistantPanel } from '../inbox/AssistantPanel';
import { SmartReplyPanel, type SmartReplyCache } from '../inbox/SmartReplyPanel';
import { useIsMobile } from '../ui/use-mobile';

export function InboxView() {
  const { ticketId } = useParams();
  const navigate = useNavigate();
  const {
    tickets, resolveTicket, addMessageToTicket, injectGuestMessage,
    activeHostFilter, agentName, devMode, resetToDemo, createTestTicket,
    deleteMessageFromTicket, kbEntries,
    draftReplies, clearDraftReply, addBotMessage, addSystemMessage,
    deleteThread, deescalateTicket,
    autoReplyProcessing, cancelAutoReply, autoReplyPausedTickets, toggleAutoReplyPause,
    autoReplyHandedOff, setAutoReplyHandedOff,
    resumeAllAI, hostSettings, notificationPrefs, updateHostSettings,
  } = useAppContext();

  const filteredTickets = activeHostFilter === 'all' ? tickets : tickets.filter(t => t.host.id === activeHostFilter);
  const activeTicket = (ticketId ? filteredTickets.find(t => t.id === ticketId) : filteredTickets[0]) || filteredTickets[0];

  // Count paused/handed-off threads for bulk resume button
  const pausedOrHandedOffCount = filteredTickets.filter(t => {
    if (autoReplyPausedTickets[t.id]) return true;
    if (autoReplyHandedOff[t.id] === true) return true;
    // Check system message for handed-off status (not explicitly resumed)
    if (autoReplyHandedOff[t.id] !== false) {
      const lastSys = [...t.messages].reverse().find(m => m.sender === 'system');
      if (lastSys?.text.toLowerCase().startsWith('routed to team') || lastSys?.text.toLowerCase().startsWith('silently routed')) return true;
    }
    return false;
  }).length;

  // Draft reply for the active ticket (if any)
  const activeDraft = activeTicket ? draftReplies[activeTicket.id] : undefined;

  // ─── Active ticket AI status (for thread header chip) ──────────
  const activeIsPaused = activeTicket ? autoReplyPausedTickets[activeTicket.id] : false;
  const activeLastSysMsg = activeTicket ? [...activeTicket.messages].reverse().find(m => m.sender === 'system') : null;
  // #23: Use structured status parser instead of brittle string prefix matching
  const activeSystemStatus = activeLastSysMsg ? parseThreadStatus(activeLastSysMsg.text) : null;
  const activeIsHandedOff = activeTicket ? (
    autoReplyHandedOff[activeTicket.id] === true
    || (autoReplyHandedOff[activeTicket.id] !== false && activeSystemStatus === 'handed-off')
  ) : false;

  const [replyText, setReplyText] = useState('');
  const [showResolveConfirm, setShowResolveConfirm] = useState(false);
  const [rightTab, setRightTab] = useState<'assistant' | 'details'>('assistant');
  const [guestMode, setGuestMode] = useState(false);
  const [showSmartReply, setShowSmartReply] = useState(false);
  const [summaryCollapsed, setSummaryCollapsed] = useState(true);
  const [viewedTickets, setViewedTickets] = useState<Record<string, number>>({});
  const [cardMenuOpen, setCardMenuOpen] = useState<string | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  useEffect(() => {
    if (!cardMenuOpen && !headerMenuOpen) return;
    const close = () => { setCardMenuOpen(null); setHeaderMenuOpen(false); };
    const t = setTimeout(() => document.addEventListener('click', close), 0);
    return () => { clearTimeout(t); document.removeEventListener('click', close); };
  }, [cardMenuOpen, headerMenuOpen]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  // Mobile panel: 'list' = inbox sidebar, 'thread' = chat, 'details' = right panel
  const [mobilePanel, setMobilePanel] = useState<'list' | 'thread' | 'details'>(ticketId ? 'thread' : 'list');
  const [showMobileDetails, setShowMobileDetails] = useState(false);

  const smartReplyCacheRef = useRef<Record<string, SmartReplyCache>>({});

  // ─── Resizable panel state (desktop only) ──────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const [leftWidth, setLeftWidth] = useState(() => {
    const saved = localStorage.getItem('inbox-left-width');
    return saved ? Math.max(240, Math.min(480, parseInt(saved))) : 320;
  });
  const [rightWidth, setRightWidth] = useState(() => {
    const saved = localStorage.getItem('inbox-right-width');
    return saved ? Math.max(260, Math.min(480, parseInt(saved))) : 320;
  });
  const [resizing, setResizing] = useState<'left' | 'right' | null>(null);

  // ─── Collapsible panel state (responsive for "nanggung" screens) ──
  const [containerWidth, setContainerWidth] = useState(1400);
  const [leftCollapsed, setLeftCollapsed] = useState(() => {
    const saved = localStorage.getItem('inbox-left-collapsed');
    return saved === 'true';
  });
  const [rightCollapsed, setRightCollapsed] = useState(() => {
    const saved = localStorage.getItem('inbox-right-collapsed');
    return saved === 'true';
  });
  const [rightOverlayOpen, setRightOverlayOpen] = useState(false);
  const [leftOverlayOpen, setLeftOverlayOpen] = useState(false);

  // Panel dimension constants
  const MIN_CENTER = 350;
  const LEFT_MIN = 240;
  const RIGHT_MIN = 260;

  // Dynamic collapse thresholds based on actual preferred widths:
  // Right collapses when both panels at minimum still can't fit alongside center
  const autoCollapseRightThreshold = LEFT_MIN + RIGHT_MIN + MIN_CENTER; // 850
  // Left collapses when (right already collapsed) left at minimum can't fit
  const autoCollapseLeftThreshold = LEFT_MIN + MIN_CENTER; // 590

  // Progressive shrink: compute display widths (shrink before collapse)
  let displayLeftWidth = leftWidth;
  let displayRightWidth = rightWidth;

  if (!isMobile && !leftCollapsed && !rightCollapsed) {
    const totalNeeded = leftWidth + rightWidth + MIN_CENTER;
    if (containerWidth < totalNeeded) {
      // Proportional shrink: both side panels shrink together toward their minimums
      const deficit = totalNeeded - containerWidth;
      const leftShrinkable = leftWidth - LEFT_MIN;
      const rightShrinkable = rightWidth - RIGHT_MIN;
      const totalShrinkable = leftShrinkable + rightShrinkable;
      if (totalShrinkable > 0) {
        const leftShare = leftShrinkable / totalShrinkable;
        const rightShare = 1 - leftShare;
        displayLeftWidth = Math.max(LEFT_MIN, Math.round(leftWidth - deficit * leftShare));
        displayRightWidth = Math.max(RIGHT_MIN, Math.round(rightWidth - deficit * rightShare));
      }
      // Guard: ensure center never goes below minimum after rounding
      const centerRemaining = containerWidth - displayLeftWidth - displayRightWidth;
      if (centerRemaining < MIN_CENTER) {
        const overshoot = MIN_CENTER - centerRemaining;
        displayRightWidth = Math.max(RIGHT_MIN, displayRightWidth - overshoot);
      }
    }
  } else if (!isMobile && rightCollapsed && !leftCollapsed) {
    // Right is collapsed — left can shrink toward its minimum
    displayLeftWidth = Math.max(LEFT_MIN, Math.min(leftWidth, containerWidth - MIN_CENTER));
  }

  // Transition flags for auto-collapse effects
  const shouldAutoCollapseRight = !isMobile && containerWidth > 0 && containerWidth < autoCollapseRightThreshold;
  const shouldAutoCollapseLeft = !isMobile && containerWidth > 0 && containerWidth < autoCollapseLeftThreshold;

  // Track container width with ResizeObserver
  useEffect(() => {
    if (!containerRef.current || isMobile) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 1400;
      setContainerWidth(w);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [isMobile]);

  // Auto-collapse/expand panels when panels have been shrunk to minimum and still can't fit
  const prevCollapseRightRef = useRef(shouldAutoCollapseRight);
  const prevCollapseLeftRef = useRef(shouldAutoCollapseLeft);

  useEffect(() => {
    if (isMobile) return;
    // Collapse right panel when both panels at min still can't fit
    if (shouldAutoCollapseRight && !prevCollapseRightRef.current) {
      setRightCollapsed(true);
      setRightOverlayOpen(false);
    }
    // Auto-expand right panel when viewport grows past threshold
    if (!shouldAutoCollapseRight && prevCollapseRightRef.current) {
      setRightCollapsed(false);
    }
    prevCollapseRightRef.current = shouldAutoCollapseRight;
  }, [shouldAutoCollapseRight, isMobile]);

  useEffect(() => {
    if (isMobile) return;
    // Collapse left panel when (right already collapsed) left at min can't fit
    if (shouldAutoCollapseLeft && !prevCollapseLeftRef.current) {
      setLeftCollapsed(true);
      setLeftOverlayOpen(false);
    }
    // Auto-expand left panel when viewport grows past threshold
    if (!shouldAutoCollapseLeft && prevCollapseLeftRef.current) {
      setLeftCollapsed(false);
    }
    prevCollapseLeftRef.current = shouldAutoCollapseLeft;
  }, [shouldAutoCollapseLeft, isMobile]);

  // Persist collapse prefs
  useEffect(() => {
    if (!isMobile) localStorage.setItem('inbox-left-collapsed', String(leftCollapsed));
  }, [leftCollapsed, isMobile]);
  useEffect(() => {
    if (!isMobile) localStorage.setItem('inbox-right-collapsed', String(rightCollapsed));
  }, [rightCollapsed, isMobile]);

  // Close overlays when expanding
  useEffect(() => {
    if (!rightCollapsed) setRightOverlayOpen(false);
    if (!leftCollapsed) setLeftOverlayOpen(false);
  }, [rightCollapsed, leftCollapsed]);

  // Persist panel widths
  useEffect(() => {
    if (!isMobile) localStorage.setItem('inbox-left-width', String(leftWidth));
  }, [leftWidth, isMobile]);
  useEffect(() => {
    if (!isMobile) localStorage.setItem('inbox-right-width', String(rightWidth));
  }, [rightWidth, isMobile]);

  // Mouse drag resize handler
  useEffect(() => {
    if (!resizing || isMobile) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const effectiveRightWidth = rightCollapsed ? 0 : rightWidth;
      const effectiveLeftWidth = leftCollapsed ? 0 : leftWidth;

      if (resizing === 'left' && !leftCollapsed) {
        let newWidth = e.clientX - rect.left;
        newWidth = Math.max(LEFT_MIN, Math.min(480, newWidth));
        if (rect.width - newWidth - effectiveRightWidth < MIN_CENTER) {
          newWidth = rect.width - effectiveRightWidth - MIN_CENTER;
        }
        if (newWidth >= LEFT_MIN) setLeftWidth(newWidth);
      } else if (resizing === 'right' && !rightCollapsed) {
        let newWidth = rect.right - e.clientX;
        newWidth = Math.max(RIGHT_MIN, Math.min(480, newWidth));
        if (rect.width - effectiveLeftWidth - newWidth < MIN_CENTER) {
          newWidth = rect.width - effectiveLeftWidth - MIN_CENTER;
        }
        if (newWidth >= RIGHT_MIN) setRightWidth(newWidth);
      }
    };

    const handleMouseUp = () => setResizing(null);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [resizing, isMobile, leftWidth, rightWidth, leftCollapsed, rightCollapsed]);

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; msgId: number; msgText: string; senderType: string } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  const [pendingDeletes, setPendingDeletes] = useState<Set<number>>(new Set());
  const deleteTimersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const scheduleDelete = useCallback((ticketId: string, msgId: number, senderLabel: string) => {
    setPendingDeletes(prev => new Set(prev).add(msgId));
    toast(`Deleted ${senderLabel}`, {
      description: 'Message will be removed permanently',
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => {
          clearTimeout(deleteTimersRef.current[msgId]);
          delete deleteTimersRef.current[msgId];
          setPendingDeletes(prev => {
            const next = new Set(prev);
            next.delete(msgId);
            return next;
          });
          toast.success('Message restored');
        },
      },
    });
    deleteTimersRef.current[msgId] = setTimeout(() => {
      deleteMessageFromTicket(ticketId, msgId);
      setPendingDeletes(prev => {
        const next = new Set(prev);
        next.delete(msgId);
        return next;
      });
      delete deleteTimersRef.current[msgId];
    }, 5000);
  }, [deleteMessageFromTicket]);

  useEffect(() => {
    return () => {
      Object.values(deleteTimersRef.current).forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const handleClickOutside = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('scroll', close, true);
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', handleKey);
    };
  }, [ctxMenu]);

  useEffect(() => { setCtxMenu(null); }, [activeTicket?.id]);

  const handleMsgContextMenu = useCallback((e: React.MouseEvent, msgId: number, msgText: string, senderType: string) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, msgId, msgText, senderType });
  }, []);

  const [showNewThread, setShowNewThread] = useState(false);
  const [ntHostId, setNtHostId] = useState(MOCK_HOSTS[0].id);
  const [ntPropName, setNtPropName] = useState('');
  const [ntGuestName, setNtGuestName] = useState('');
  const [ntMessage, setNtMessage] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCancelMenu, setShowCancelMenu] = useState(false);

  const ntProps = MOCK_PROPERTIES.filter(p => p.hostId === ntHostId);
  useEffect(() => {
    const props = MOCK_PROPERTIES.filter(p => p.hostId === ntHostId);
    setNtPropName(props[0]?.name || '');
  }, [ntHostId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeTicket?.messages.length]);

  // When ticket changes, switch mobile to thread view if a ticketId is in the URL
  useEffect(() => {
    if (isMobile && ticketId) {
      setMobilePanel('thread');
    }
  }, [ticketId, isMobile]);

  useEffect(() => {
    if (!activeTicket) return;
    setRightTab('assistant');
    setShowSmartReply(false);
    setGuestMode(false);
    setViewedTickets(prev => ({ ...prev, [activeTicket.id]: activeTicket.messages.length }));
  }, [activeTicket?.id]);

  useEffect(() => {
    if (!activeTicket) return;
    setViewedTickets(prev => ({ ...prev, [activeTicket.id]: activeTicket.messages.length }));
  }, [activeTicket?.messages.length]);

  // #10: Toast notification for new guest messages on non-active threads
  const prevTicketCountsRef = useRef<Record<string, number>>({});
  useEffect(() => {
    for (const t of filteredTickets) {
      const prevCount = prevTicketCountsRef.current[t.id];
      if (prevCount !== undefined && t.messages.length > prevCount) {
        const newMsgs = t.messages.slice(prevCount);
        const newGuestMsgs = newMsgs.filter(m => m.sender === 'guest' && !m.isGuestMode);
        if (newGuestMsgs.length > 0 && t.id !== activeTicket?.id && notificationPrefs.soundAlerts) {
          toast(`New message from ${t.guestName}`, {
            description: newGuestMsgs[0].text.slice(0, 80) + (newGuestMsgs[0].text.length > 80 ? '…' : ''),
            duration: 5000,
            action: {
              label: 'View',
              onClick: () => navigate(`/inbox/${t.id}`),
            },
          });
        }
      }
      prevTicketCountsRef.current[t.id] = t.messages.length;
    }
  }, [filteredTickets, activeTicket?.id, notificationPrefs.soundAlerts, navigate]);

  const handleGlobalKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'A') {
      e.preventDefault();
      setShowSmartReply(prev => !prev);
      setGuestMode(false);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'R') {
      e.preventDefault();
      if (activeTicket) setShowResolveConfirm(true);
      return;
    }
  }, [activeTicket]);

  useEffect(() => {
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleGlobalKeyDown]);

  if (!activeTicket) {
    return (
      <div className="flex-1 flex items-center justify-center flex-col gap-3 text-slate-500 px-6 text-center">
        <Bot size={48} className="text-slate-300" />
        <p className="font-bold text-slate-700">No active tickets</p>
        <p className="text-sm">All tickets have been resolved, or no tickets match this workspace filter.</p>
      </div>
    );
  }

  const hasUnread = (tid: string, msgCount: number) => {
    const viewed = viewedTickets[tid];
    return viewed !== undefined ? msgCount > viewed : false;
  };

  const handleSendMessage = () => {
    if (!replyText.trim()) {
      toast.error('Cannot send empty message');
      return;
    }
    if (guestMode) {
      injectGuestMessage(activeTicket.id, replyText.trim(), true);
      setReplyText('');
      toast.success('Guest message injected (test)', { description: `Sent as ${activeTicket.guestName}. AI will respond if enabled.` });
    } else {
      // #18: If sending a draft as-is, add audit trail system message
      if (activeDraft && replyText.trim() === activeDraft.trim()) {
        addSystemMessage(activeTicket.id, `Draft sent as-is — Agent sent the AI-drafted reply without edits.`);
      }
      // Auto-clear Follow-up badge when agent replies after a partial status
      const lastSys = [...activeTicket.messages].reverse().find(m => m.sender === 'system');
      if (lastSys && parseThreadStatus(lastSys.text) === 'partial') {
        addSystemMessage(activeTicket.id, `AI handled — Agent followed up.`);
      }
      addMessageToTicket(activeTicket.id, replyText.trim());
      setReplyText('');
      setShowSmartReply(false);
      if (activeDraft) clearDraftReply(activeTicket.id);
      toast.success('Message sent', { description: `Reply sent to ${activeTicket.guestName} via ${activeTicket.channel}` });
    }
  };

  const handleResolve = () => {
    const guestMessages = activeTicket.messages.filter(m => m.sender === 'guest').map(m => m.text);
    const inquiries = detectInquiries(guestMessages, activeTicket.tags, activeTicket.summary);
    const activeProp = MOCK_PROPERTIES.find(p => p.name === activeTicket.property);
    const scopeKb = kbEntries.filter(kb =>
      kb.hostId === activeTicket.host.id &&
      (!kb.propId || kb.propId === activeProp?.id)
    );
    const uncoveredTopics = inquiries.filter(inq => {
      const matches = scoreKBForInquiry(inq, scopeKb);
      return matches.length === 0;
    }).map(inq => inq.label);

    const nextTicket = filteredTickets.find(t => t.id !== activeTicket.id);
    resolveTicket(activeTicket.id);
    toast.success('Ticket resolved', { description: `${activeTicket.guestName}'s ticket marked as resolved.` });

    if (uncoveredTopics.length > 0 && activeProp) {
      setTimeout(() => {
        toast(`Add to knowledge base: ${uncoveredTopics.join(', ')}`, {
          description: 'These topics weren\'t in the knowledge base. Adding them helps AI handle similar questions next time.',
          duration: 8000,
          action: {
            label: 'Add now',
            onClick: () => navigate(`/kb/${activeProp.id}`),
          },
        });
      }, 500);
    }

    if (nextTicket) {
      navigate(`/inbox/${nextTicket.id}`);
    } else {
      navigate('/inbox');
      if (isMobile) setMobilePanel('list');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleComposeReply = (text: string) => {
    setReplyText(text);
  };

  const handleSmartReplyInsert = (text: string) => {
    setReplyText(text);
    setShowSmartReply(false);
    toast.success('Reply inserted', { description: 'Review the message and send when ready.' });
  };

  const toggleSmartReply = () => {
    setShowSmartReply(prev => !prev);
    if (guestMode) setGuestMode(false);
  };

  // #22: Guest mode toggle (no confirmation needed — AI auto-reply handles guest messages)
  const toggleGuestMode = () => {
    if (!guestMode) {
      setGuestMode(true);
      setShowSmartReply(false);
    } else {
      setGuestMode(false);
    }
  };

  return (
    <div ref={containerRef} className={`flex h-full w-full overflow-hidden animate-in fade-in duration-200 relative ${resizing ? 'select-none' : ''}`}>

      {/* Left panel collapsed rail (desktop only) */}
      {!isMobile && leftCollapsed && (
        <div className="flex flex-col items-center w-10 shrink-0 bg-white border-r border-slate-200 py-3 gap-2">
          <button
            onClick={() => {
              if (shouldAutoCollapseLeft) {
                setLeftOverlayOpen(true);
              } else {
                setLeftCollapsed(false);
              }
            }}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
            title="Show inbox list"
          >
            <PanelLeftOpen size={16} />
          </button>
          <span className="bg-slate-200 text-slate-600 text-[9px] px-1.5 py-0.5 rounded-full font-bold">{filteredTickets.length}</span>
        </div>
      )}

      {/* Left overlay backdrop (for narrow screens) */}
      {!isMobile && leftCollapsed && leftOverlayOpen && (
        <div
          className="absolute inset-0 z-40 bg-black/10"
          onClick={() => setLeftOverlayOpen(false)}
        />
      )}

      {/* Inbox List Pane */}
      <div
        className={`${
          isMobile
            ? (mobilePanel === 'list' ? 'flex w-full' : 'hidden')
            : leftCollapsed
              ? (leftOverlayOpen ? 'flex absolute left-10 top-0 bottom-0 z-50 shadow-2xl rounded-r-xl animate-in slide-in-from-left duration-200' : 'hidden')
              : 'flex shrink-0 overflow-hidden'
        } bg-white border-r border-slate-200 flex-col`}
        style={!isMobile ? { width: leftCollapsed && leftOverlayOpen ? Math.min(leftWidth, 360) : leftCollapsed ? 0 : displayLeftWidth, minWidth: leftCollapsed ? 0 : LEFT_MIN, transition: resizing ? 'none' : 'width 0.2s ease' } : undefined}
      >
        <div className="p-4 border-b border-slate-200 bg-slate-50">
          <h2 className="text-lg font-bold text-slate-800 flex items-center justify-between">
            Inbox
            <div className="flex items-center gap-2">
              {!isMobile && (
                <button
                  onClick={() => { setLeftCollapsed(true); setLeftOverlayOpen(false); }}
                  className="w-5 h-5 rounded flex items-center justify-center text-slate-300 hover:text-indigo-500 hover:bg-indigo-50 transition-colors"
                  title="Collapse sidebar"
                >
                  <ChevronsLeft size={12} />
                </button>
              )}
              <button
                onClick={() => setShowNewThread(prev => !prev)}
                className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors ${
                  showNewThread
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-200 text-slate-500 hover:bg-indigo-100 hover:text-indigo-600'
                }`}
                title="Start a new test conversation"
              >
                <Plus size={14} />
              </button>
              <span className="bg-slate-200 text-slate-600 text-xs px-2 py-1 rounded-full">{filteredTickets.length}</span>
            </div>
          </h2>
        </div>

        {showNewThread && (
          <div className="p-3 border-b border-indigo-200 bg-indigo-50/50 animate-in slide-in-from-top-2 duration-150 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider flex items-center gap-1">
                <UserCircle size={11} /> New test thread
              </span>
              <button onClick={() => setShowNewThread(false)} className="text-slate-400 hover:text-slate-600">
                <X size={12} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <select
                value={ntHostId}
                onChange={(e) => setNtHostId(e.target.value)}
                className="text-[11px] px-2 py-1.5 rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-300"
              >
                {MOCK_HOSTS.map(h => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
              <select
                value={ntPropName}
                onChange={(e) => setNtPropName(e.target.value)}
                className="text-[11px] px-2 py-1.5 rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-300"
              >
                {ntProps.map(p => (
                  <option key={p.id} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>
            <input
              type="text"
              value={ntGuestName}
              onChange={(e) => setNtGuestName(e.target.value)}
              placeholder="Guest name (e.g. Alex Kim)"
              className="w-full text-[11px] px-2 py-1.5 rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-300 placeholder:text-slate-400"
            />
            <input
              type="text"
              value={ntMessage}
              onChange={(e) => setNtMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && ntMessage.trim() && ntGuestName.trim()) {
                  e.preventDefault();
                  const newId = createTestTicket({
                    hostId: ntHostId,
                    propertyName: ntPropName,
                    guestName: ntGuestName.trim(),
                    firstMessage: ntMessage.trim(),
                  });
                  toast.success('Test thread created', { description: `${ntGuestName.trim()} → ${ntPropName}` });
                  setNtGuestName('');
                  setNtMessage('');
                  setShowNewThread(false);
                  navigate(`/inbox/${newId}`);
                }
              }}
              placeholder="First guest message... (Enter to create)"
              className="w-full text-[11px] px-2 py-1.5 rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-300 placeholder:text-slate-400"
            />
            <button
              onClick={() => {
                if (!ntMessage.trim() || !ntGuestName.trim()) {
                  toast.error('Name and message required');
                  return;
                }
                const newId = createTestTicket({
                  hostId: ntHostId,
                  propertyName: ntPropName,
                  guestName: ntGuestName.trim(),
                  firstMessage: ntMessage.trim(),
                });
                toast.success('Test thread created', { description: `${ntGuestName.trim()} → ${ntPropName}` });
                setNtGuestName('');
                setNtMessage('');
                setShowNewThread(false);
                navigate(`/inbox/${newId}`);
              }}
              disabled={!ntMessage.trim() || !ntGuestName.trim()}
              className="w-full text-[11px] font-medium py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
            >
              <Plus size={12} /> Create thread
            </button>
          </div>
        )}

        <div className="overflow-y-auto flex-1">
          {filteredTickets.map(ticket => {
            const isActive = activeTicket.id === ticket.id;
            const unread = hasUnread(ticket.id, ticket.messages.length);
            const isProcessing = autoReplyProcessing[ticket.id];
            const isPaused = autoReplyPausedTickets[ticket.id];
            const lastGuestMsg = [...ticket.messages].reverse().find(m => m.sender === 'guest');

            // ─── Smart preview: last message in thread (whoever sent it) ──
            const lastSystemMsg = [...ticket.messages].reverse().find(m => m.sender === 'system');
            const systemStatus = lastSystemMsg ? parseThreadStatus(lastSystemMsg.text) : null;

            // Last non-system message for the preview card
            const lastNonSystemMsg = [...ticket.messages].reverse().find(m => m.sender !== 'system');
            const previewSender = lastNonSystemMsg?.sender === 'guest' ? ticket.guestName.split(' ')[0]
              : lastNonSystemMsg?.sender === 'bot' ? 'AI'
              : lastNonSystemMsg?.sender === 'agent' ? 'You'
              : lastNonSystemMsg?.sender === 'host' ? 'Host'
              : '';
            const previewText = lastNonSystemMsg?.text || ticket.aiHandoverReason || '';

            // #11/#25: Use createdAt epoch for accurate time-since calculation
            const guestMsgCount = ticket.messages.filter(m => m.sender === 'guest').length;
            let timeSinceGuest = '';
            if (lastGuestMsg) {
              const ts = lastGuestMsg.createdAt;
              if (ts) {
                const diffMin = Math.max(0, Math.floor((Date.now() - ts) / 60000));
                if (diffMin < 1) timeSinceGuest = 'just now';
                else if (diffMin < 60) timeSinceGuest = `${diffMin}m ago`;
                else if (diffMin < 1440) timeSinceGuest = `${Math.floor(diffMin / 60)}h ago`;
                else timeSinceGuest = `${Math.floor(diffMin / 1440)}d ago`;
              } else {
                timeSinceGuest = lastGuestMsg.time;
              }
            }

            // Explicit false in autoReplyHandedOff overrides system message status (user clicked Resume AI)
            const isHandedOff = autoReplyHandedOff[ticket.id] === true
              || (autoReplyHandedOff[ticket.id] !== false && systemStatus === 'handed-off');

            return (
              <div
                key={ticket.id}
                onClick={() => { navigate(`/inbox/${ticket.id}`); setReplyText(''); if (isMobile) setMobilePanel('thread'); if (leftOverlayOpen) setLeftOverlayOpen(false); }}
                className={`group px-3 py-3 border-b border-slate-100 cursor-pointer relative overflow-hidden flex gap-2.5 ${
                  isActive
                    ? 'bg-indigo-50/80 border-l-[3px] border-l-indigo-500'
                    : `border-l-[3px] hover:bg-slate-50 ${
                        ticket.status === 'urgent' ? 'border-l-red-400'
                        : ticket.status === 'warning' ? 'border-l-amber-400'
                        : 'border-l-transparent'
                      }`
                }`}
              >


                {/* Avatar + Content shift together on hover */}
                <div className="flex gap-2.5 flex-1 min-w-0">

                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0 mt-0.5 ${
                  ticket.status === 'urgent' ? 'bg-red-400' : ticket.status === 'warning' ? 'bg-amber-400' : 'bg-slate-300'
                }`}>
                  {ticket.guestName.charAt(0)}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  {/* Row 1: name + SLA */}
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {unread && !isActive && <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full shrink-0" />}
                      <span className={`text-sm truncate ${unread && !isActive ? 'font-bold text-slate-900' : 'font-semibold text-slate-800'}`}>{ticket.guestName}</span>
                    </div>
                    <span className={`text-[11px] font-semibold tabular-nums pr-5 ${
                      ticket.status === 'urgent' ? 'text-red-500' : ticket.status === 'warning' ? 'text-amber-500' : 'text-slate-400'
                    }`}>{ticket.sla}</span>
                  </div>

                  {/* Row 2: badges inline */}
                  <div className="flex items-center gap-1 mb-1 flex-nowrap overflow-hidden">
                    {/* AI Toggle */}
                    {(() => {
                      const hostAutoReply = hostSettings.find(s => s.hostId === ticket.host.id)?.autoReply ?? false;
                      const aiOff = !hostAutoReply || isPaused;
                      return (
                        <motion.button
                          key={aiOff ? 'off' : 'on'}
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: 0.15 }}
                          onClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                            if (!hostAutoReply) {
                              updateHostSettings(ticket.host.id, { autoReply: true });
                              if (isPaused) toggleAutoReplyPause(ticket.id);
                              if (isHandedOff) setAutoReplyHandedOff(ticket.id, false);
                              toast.success('Auto-reply enabled', { description: `AI is now active for ${ticket.host.name}.`, duration: 3000 });
                            } else if (isPaused || isHandedOff) {
                              if (isPaused) toggleAutoReplyPause(ticket.id);
                              if (isHandedOff) setAutoReplyHandedOff(ticket.id, false);
                              toast.success('AI enabled', { description: `Auto-reply active for ${ticket.guestName}.`, duration: 3000 });
                            } else {
                              toggleAutoReplyPause(ticket.id);
                              toast('AI paused', { description: `You're handling ${ticket.guestName} manually.`, duration: 3000 });
                            }
                          }}
                          className={`inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border transition-colors cursor-pointer shrink-0 ${
                            !hostAutoReply || aiOff
                              ? 'bg-slate-100 text-slate-400 border-slate-200 hover:border-violet-300 hover:text-violet-500'
                              : 'bg-violet-50 text-violet-600 border-violet-200 hover:bg-slate-100 hover:text-slate-400'
                          }`}
                        >
                          {aiOff ? <><PauseCircle size={8} /> AI Off</> : <><Zap size={8} /> AI On</>}
                        </motion.button>
                      );
                    })()}

                    {/* Status badge */}
                    {(() => {
                      const agentClearedHandoff = autoReplyHandedOff[ticket.id] === false;
                      const effectiveStatus = isHandedOff
                        ? 'handed-off'
                        : (agentClearedHandoff && systemStatus === 'handed-off') ? null : systemStatus;
                      if (effectiveStatus === 'ai-handled') return null;
                      const statusLabel = effectiveStatus === 'handed-off' ? 'Your Turn'
                        : effectiveStatus === 'partial' ? 'Follow-up'
                        : effectiveStatus === 'safety' ? 'Safety Alert'
                        : null;
                      if (!statusLabel) return null;
                      const StatusIcon = effectiveStatus === 'handed-off' ? ArrowRightLeft : effectiveStatus === 'partial' ? AlertCircle : ShieldAlert;
                      const statusColor = effectiveStatus === 'safety' ? 'bg-red-50 text-red-500 border-red-200'
                        : effectiveStatus === 'partial' ? 'bg-sky-50 text-sky-500 border-sky-200'
                        : 'bg-amber-50 text-amber-500 border-amber-200';
                      return (
                        <motion.span key={effectiveStatus} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.15 }}
                          className={`inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border shrink-0 ${statusColor}`}>
                          <StatusIcon size={8} /> {statusLabel}
                        </motion.span>
                      );
                    })()}

                    {/* Meta: property · time */}
                    <span className="text-[10px] text-slate-400 truncate ml-0.5">{ticket.property} · {timeSinceGuest}</span>
                  </div>

                  {/* Row 3: preview + chevron on hover */}
                  <div className="flex items-center gap-1">
                    <p className={`text-[11px] leading-snug line-clamp-1 flex-1 min-w-0 ${unread && !isActive ? 'text-slate-600' : 'text-slate-400'}`}>
                      {previewSender && (
                        <span className={`font-medium ${
                          lastNonSystemMsg?.sender === 'bot' ? 'text-violet-400' : 'text-slate-400'
                        }`}>{previewSender}: </span>
                      )}{previewText}
                    </p>
                    <div className="relative shrink-0 w-0 group-hover:w-5 overflow-visible transition-all duration-150">
                      <button
                        onClick={(e) => { e.stopPropagation(); setCardMenuOpen(cardMenuOpen === ticket.id ? null : ticket.id); }}
                        className="w-5 h-5 flex items-center justify-center rounded text-slate-300 hover:text-slate-500 hover:bg-slate-100 transition-colors opacity-0 group-hover:opacity-100 duration-150"
                      >
                        <ChevronDown size={13} />
                      </button>
                      {cardMenuOpen === ticket.id && (
                        <div className="absolute right-0 bottom-7 bg-white border border-slate-200 rounded-xl shadow-lg py-1 w-40 z-50">
                          <button
                            onClick={(e) => { e.stopPropagation(); setCardMenuOpen(null); setShowDeleteConfirm(true); navigate(`/inbox/${ticket.id}`); }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 size={13} /> Delete thread
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  {/* AI processing indicator */}
                  <AnimatePresence>
                    {isProcessing && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-1.5 flex items-center gap-1.5 text-[10px] font-bold text-violet-600 uppercase tracking-wider overflow-hidden"
                      >
                        <Loader2 size={10} className="animate-spin" />
                        <span>AI preparing reply…</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            cancelAutoReply(ticket.id);
                            setShowCancelMenu(true);
                            navigate(`/inbox/${ticket.id}`);
                          }}
                          className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-violet-100 hover:bg-red-100 hover:text-red-600 transition-colors border border-violet-200"
                        >
                          Stop
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {draftReplies[ticket.id] && !isProcessing && (
                    <div className="mt-1 flex items-center gap-1 text-[10px] font-bold text-violet-600 uppercase tracking-wider">
                      <FileEdit size={10} /> Draft pending
                    </div>
                  )}
                </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Left resize handle (desktop only, when not collapsed) */}
      {!isMobile && !leftCollapsed && (
        <div
          className={`w-px shrink-0 cursor-col-resize relative group z-20 transition-colors ${resizing === 'left' ? 'bg-indigo-400' : 'bg-slate-200 hover:bg-indigo-400'}`}
          onMouseDown={(e) => { e.preventDefault(); setResizing('left'); }}
          onDoubleClick={() => setLeftWidth(320)}
          title="Drag to resize • Double-click to reset"
        >
          <div className="absolute inset-y-0 -left-2 -right-2" />
        </div>
      )}

      {/* Chat Pane */}
      <div className={`${isMobile ? (mobilePanel === 'thread' ? 'flex w-full' : 'hidden') : 'flex flex-1'} flex-col bg-slate-50 min-w-0`}>
        {/* Header */}
        <div className="bg-white border-b border-slate-200 px-3 py-2 flex items-center gap-2 shrink-0 shadow-sm z-10 min-h-[52px]">
          {/* Mobile back */}
          {isMobile && (
            <button onClick={() => { setMobilePanel('list'); navigate('/inbox'); }} className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors">
              <ArrowLeft size={18} />
            </button>
          )}

          {/* Guest info — takes remaining space */}
          <div className="min-w-0 flex-1">
            <div className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider truncate">
              {activeTicket.property}
            </div>
            <h1 className="text-sm font-bold truncate text-slate-800 leading-tight">{activeTicket.guestName}</h1>
          </div>

          {/* Actions — always visible */}
          {activeTicket && (() => {
            const hostAutoReply = hostSettings.find(s => s.hostId === activeTicket.host.id)?.autoReply ?? false;
            const aiOff = !hostAutoReply || activeIsPaused;
            return (
              <button
                onClick={() => {
                  if (!hostAutoReply) {
                    updateHostSettings(activeTicket.host.id, { autoReply: true });
                    if (activeIsPaused) toggleAutoReplyPause(activeTicket.id);
                    if (activeIsHandedOff) setAutoReplyHandedOff(activeTicket.id, false);
                    toast.success('Auto-reply enabled', { description: `AI is now active for ${activeTicket.host.name}.`, duration: 3000 });
                  } else if (activeIsPaused || activeIsHandedOff) {
                    if (activeIsPaused) toggleAutoReplyPause(activeTicket.id);
                    if (activeIsHandedOff) setAutoReplyHandedOff(activeTicket.id, false);
                    toast.success('AI enabled', { description: `Auto-reply active for ${activeTicket.guestName}.`, duration: 3000 });
                  } else {
                    toggleAutoReplyPause(activeTicket.id);
                    toast('AI paused', { description: `You're handling ${activeTicket.guestName} manually.`, duration: 3000 });
                  }
                }}
                className={`flex items-center gap-1 text-[9px] font-bold px-2 py-1 rounded-full border transition-colors whitespace-nowrap cursor-pointer shrink-0 ${
                  aiOff
                    ? 'bg-slate-100 text-slate-400 border-slate-200 hover:bg-violet-50 hover:text-violet-600 hover:border-violet-300'
                    : 'bg-violet-50 text-violet-600 border-violet-200 hover:bg-slate-100 hover:text-slate-400 hover:border-slate-200'
                }`}
              >
                {aiOff ? <><PauseCircle size={9} /> AI Off</> : <><Zap size={9} /> AI On</>}
              </button>
            );
          })()}

          {/* Status badge — hidden on very narrow */}
          {(activeSystemStatus || activeIsHandedOff) && (() => {
            const eff = activeIsHandedOff ? 'handed-off' : activeSystemStatus;
            if (eff === 'ai-handled') return null;
            const statusLabel = eff === 'handed-off' ? 'Your Turn' : eff === 'partial' ? 'Follow-up' : eff === 'safety' ? 'Safety Alert' : null;
            if (!statusLabel) return null;
            const StatusIcon = eff === 'handed-off' ? ArrowRightLeft : eff === 'partial' ? AlertCircle : ShieldAlert;
            const statusColor = eff === 'safety' ? 'bg-red-50 text-red-500 border-red-200' : eff === 'partial' ? 'bg-sky-50 text-sky-500 border-sky-200' : 'bg-amber-50 text-amber-500 border-amber-200';
            return (
              <span className={`hidden sm:flex items-center gap-1 text-[9px] font-bold px-2 py-1 rounded-full border whitespace-nowrap shrink-0 ${statusColor}`}>
                <StatusIcon size={9} /> {statusLabel}
              </span>
            );
          })()}

          {/* Resolve */}
          <button
            onClick={() => setShowResolveConfirm(true)}
            className="px-2.5 py-1.5 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 flex items-center gap-1 shadow-sm transition-colors active:scale-95 shrink-0"
            title="Ctrl+Shift+R"
          >
            <CheckCircle size={12} /> Resolve
          </button>

          {/* ⋮ More menu */}
          <div className="relative shrink-0">
            <button
              onClick={() => setHeaderMenuOpen(p => !p)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
            >
              <MoreVertical size={15} />
            </button>
            {headerMenuOpen && (
              <div className="absolute right-0 top-9 bg-white border border-slate-200 rounded-xl shadow-lg py-1 w-52 z-50" onClick={e => e.stopPropagation()}>
                {/* Status badge on mobile */}
                {(activeSystemStatus || activeIsHandedOff) && (() => {
                  const eff = activeIsHandedOff ? 'handed-off' : activeSystemStatus;
                  if (!eff || eff === 'ai-handled') return null;
                  const statusLabel = eff === 'handed-off' ? 'Your Turn' : eff === 'partial' ? 'Follow-up' : eff === 'safety' ? 'Safety Alert' : null;
                  if (!statusLabel) return null;
                  const StatusIcon = eff === 'handed-off' ? ArrowRightLeft : eff === 'partial' ? AlertCircle : ShieldAlert;
                  return (
                    <div className="sm:hidden px-3 py-2 flex items-center gap-2 text-sm text-slate-600 border-b border-slate-100">
                      <StatusIcon size={13} /> {statusLabel}
                    </div>
                  );
                })()}
                {/* Channel */}
                <div className="px-3 py-2 flex items-center gap-2 text-xs text-slate-500 border-b border-slate-100">
                  <activeTicket.channelIcon size={12} /> {activeTicket.channel}
                  <span className="text-slate-300 mx-1">·</span>
                  <span className="truncate text-slate-400">{activeTicket.host.name}</span>
                </div>
                {/* Panel toggle */}
                {!isMobile && (
                  <button
                    onClick={() => {
                      setHeaderMenuOpen(false);
                      if (rightCollapsed) {
                        if (shouldAutoCollapseRight) setRightOverlayOpen(p => !p);
                        else setRightCollapsed(false);
                      } else {
                        setRightCollapsed(true); setRightOverlayOpen(false);
                      }
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    {rightCollapsed ? <PanelRightOpen size={13} /> : <PanelRightClose size={13} />}
                    {rightCollapsed ? 'Show context panel' : 'Hide context panel'}
                  </button>
                )}
                {isMobile && (
                  <button
                    onClick={() => { setHeaderMenuOpen(false); setShowMobileDetails(p => !p); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    <PanelRightOpen size={13} /> {showMobileDetails ? 'Hide details' : 'Show details'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* AI Context Summary Banner */}
        <button
          onClick={() => setSummaryCollapsed(!summaryCollapsed)}
          className="bg-indigo-50/50 border-b border-indigo-100 shrink-0 text-left w-full transition-all hover:bg-indigo-50/80"
        >
          {summaryCollapsed ? (
            <div className="px-3 md:px-4 py-2 flex items-center gap-2">
              <Sparkles size={12} className="text-indigo-500 shrink-0" />
              <p className="text-xs text-indigo-800 truncate flex-1">
                <span className="font-bold">AI:</span> {activeTicket.summary}
              </p>
              <div className="flex items-center gap-1.5 shrink-0">
                {activeTicket.tags.slice(0, 2).map(tag => (
                  <span key={tag} className="text-[9px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full">{tag}</span>
                ))}
                {activeTicket.tags.length > 2 && (
                  <span className="text-[9px] text-indigo-400">+{activeTicket.tags.length - 2}</span>
                )}
              </div>
              <ChevronDown size={12} className="text-indigo-400 shrink-0" />
            </div>
          ) : (
            <div className="p-4">
              <div className="flex items-start gap-3">
                <div className="bg-indigo-100 p-2 rounded-full text-indigo-600 mt-0.5"><Sparkles size={16} /></div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-indigo-800 uppercase tracking-wider mb-1">AI Context Summary</h3>
                    <ChevronDown size={12} className="text-indigo-400 rotate-180" />
                  </div>
                  <p className="text-sm text-indigo-900 leading-relaxed">{activeTicket.summary}</p>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {activeTicket.tags.map(tag => (
                      <span key={tag} className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Tag size={8} /> {tag}
                      </span>
                    ))}
                    <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Globe2 size={8} /> {activeTicket.language}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </button>

        {/* Chat messages */}
        <div className={`flex-1 overflow-y-auto ${isMobile ? 'p-3 gap-3' : 'p-6 gap-4'} flex flex-col`}>
          {activeTicket.messages.map((msg) => (
            <div key={msg.id} className={`flex flex-col transition-all duration-300 ${
              pendingDeletes.has(msg.id) ? 'opacity-20 scale-95 pointer-events-none' : ''
            } ${
              msg.sender === 'guest' ? `self-start ${isMobile ? 'max-w-[90%]' : 'max-w-[80%]'}` :
              msg.sender === 'system' ? 'self-center w-full max-w-[560px] my-1' :
              `self-end ${isMobile ? 'max-w-[90%]' : 'max-w-[80%]'}`
            }`}
              onContextMenu={msg.sender !== 'system' && !pendingDeletes.has(msg.id) ? (e) => handleMsgContextMenu(e, msg.id, msg.text, msg.sender) : undefined}
            >
              {msg.sender === 'system' ? (
                (() => {
                  const t = msg.text.toLowerCase().trimStart();
                  // Action-required: colored boxes (agent must act) — new + legacy prefixes
                  const isSafety  = t.startsWith('safety alert') || t.startsWith('guest safety flag') || t.startsWith('urgent —');
                  const isHandoff = t.startsWith('routed to team') || t.startsWith('silently routed') || t.startsWith('handed to agent');
                  // Informational: thin centered dividers — new + legacy prefixes
                  const isPartial      = t.startsWith('follow-up needed') || t.startsWith('partially answered');
                  const isReEscalation = t.startsWith('no reply in');
                  const isAINote       = t.startsWith('ai note');

                  // Plain function (not a component) to render divider-style informational messages.
                  // Using a plain function avoids the React anti-pattern of defining components inside render.
                  const divider = (colorLine: string, textCls: string, Icon: any, text: string) => (
                    <div className={`flex items-center gap-2 text-[10px] ${textCls} w-full min-w-0`}>
                      <div className={`flex-1 h-px ${colorLine} shrink`} />
                      <span className={`flex items-center gap-1 min-w-0 truncate font-medium`}>
                        <Icon size={10} className="shrink-0" />{text}
                      </span>
                      <div className={`flex-1 h-px ${colorLine} shrink`} />
                    </div>
                  );

                  if (isSafety) {
                    return (
                      <div className="bg-red-50 border border-red-200 text-red-800 text-xs px-3 py-2 rounded-lg flex items-center gap-2 shadow-sm min-w-0">
                        <ShieldAlert size={13} className="text-red-500 shrink-0" />
                        <span className="font-medium min-w-0 break-words">{msg.text}</span>
                      </div>
                    );
                  }
                  if (isHandoff) {
                    return (
                      <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2 rounded-lg flex items-center gap-2 shadow-sm min-w-0">
                        <ArrowRightLeft size={13} className="text-amber-500 shrink-0" />
                        <span className="font-medium min-w-0 break-words">{msg.text}</span>
                      </div>
                    );
                  }
                  if (isPartial)      return divider('bg-sky-200',    'text-sky-500',    AlertCircle, msg.text);
                  if (isReEscalation) return divider('bg-orange-200', 'text-orange-500', Clock,       msg.text);
                  if (isAINote)       return divider('bg-slate-200',  'text-slate-400 italic', Bot,   msg.text);
                  // Default
                  return divider('bg-slate-200', 'text-slate-400', Info, msg.text);
                })()
              ) : msg.sender === 'bot' ? (
                <>
                  <span className="text-[10px] text-slate-400 mb-1 px-1 text-right flex items-center gap-1 justify-end">
                    <Bot size={10} className="text-violet-500" /> AI Auto-Reply &bull; {msg.time}
                  </span>
                  <div className="p-3 rounded-2xl shadow-sm text-sm bg-violet-100 border border-violet-200 text-slate-800 rounded-tr-sm">
                    {msg.text}
                  </div>
                </>
              ) : msg.sender === 'host' ? (
                <>
                  <span className="text-[10px] text-slate-400 mb-1 px-1 text-right flex items-center gap-1 justify-end">
                    <Home size={10} className="text-amber-600" /> {activeTicket.host.name} &bull; {msg.time}
                  </span>
                  <div className="p-3 rounded-2xl shadow-sm text-sm bg-amber-50 border border-amber-200 text-slate-800 rounded-tr-sm">
                    {msg.text}
                  </div>
                </>
              ) : (
                <>
                  <span className={`text-[10px] text-slate-400 mb-1 px-1 ${msg.sender === 'guest' ? 'text-left' : 'text-right'}`}>
                    {msg.sender === 'guest' ? activeTicket.guestName : agentName}
                    {/* #19: Visual flag for guest-mode test messages */}
                    {msg.isGuestMode && <span className="ml-1 text-[9px] font-bold text-amber-500">(TEST)</span>}
                    {' '}&bull; {msg.time}
                  </span>
                  <div className={`p-3 rounded-2xl shadow-sm text-sm ${
                    msg.sender === 'guest'
                      ? 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'
                      : 'bg-indigo-600 text-white rounded-tr-sm'
                  }`}>{msg.text}</div>
                </>
              )}
            </div>
          ))}
          {/* AI processing typing indicator in chat */}
          <AnimatePresence>
            {autoReplyProcessing[activeTicket.id] && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="self-end flex flex-col items-end max-w-[80%]"
              >
                <span className="text-[10px] text-slate-400 mb-1 px-1 text-right flex items-center gap-1 justify-end">
                  <Bot size={10} className="text-violet-500" /> AI Auto-Reply
                </span>
                <div className="p-3 rounded-2xl shadow-sm text-sm bg-violet-50 border border-violet-200 rounded-tr-sm flex items-center gap-3">
                  <div className="flex gap-1">
                    <motion.span
                      className="w-2 h-2 bg-violet-400 rounded-full"
                      animate={{ y: [0, -6, 0] }}
                      transition={{ duration: 0.6, repeat: Infinity, delay: 0 }}
                    />
                    <motion.span
                      className="w-2 h-2 bg-violet-400 rounded-full"
                      animate={{ y: [0, -6, 0] }}
                      transition={{ duration: 0.6, repeat: Infinity, delay: 0.15 }}
                    />
                    <motion.span
                      className="w-2 h-2 bg-violet-400 rounded-full"
                      animate={{ y: [0, -6, 0] }}
                      transition={{ duration: 0.6, repeat: Infinity, delay: 0.3 }}
                    />
                  </div>
                  <span className="text-xs text-violet-600 font-medium">Preparing reply…</span>
                  <button
                    onClick={() => {
                      cancelAutoReply(activeTicket.id);
                      setShowCancelMenu(true);
                    }}
                    className="text-[10px] px-2 py-1 rounded-md bg-violet-100 hover:bg-red-100 text-violet-600 hover:text-red-600 transition-colors border border-violet-200 font-medium flex items-center gap-1"
                  >
                    <Square size={8} /> Stop
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={chatEndRef} />
        </div>

        {/* Smart Reply Panel */}
        {showSmartReply && !guestMode && (
          <SmartReplyPanel
            ticket={activeTicket}
            existingDraft={replyText}
            onInsert={handleSmartReplyInsert}
            onHide={() => setShowSmartReply(false)}
            cacheRef={smartReplyCacheRef}
          />
        )}

        {/* Reply area */}
        <div className={`px-3 py-2 md:px-4 md:py-3 border-t shrink-0 transition-colors ${
          guestMode ? 'bg-emerald-50/80 border-emerald-200' : 'bg-white border-slate-200'
        }`}>
          {activeDraft && !guestMode && (
            <div className="mb-3 bg-violet-50 border border-violet-200 rounded-xl p-3 animate-in slide-in-from-bottom-2 duration-200">
              <div className="flex items-center gap-2 mb-2">
                <FileEdit size={12} className="text-violet-600" />
                <span className="text-[10px] font-bold text-violet-700 uppercase tracking-wider">AI Draft — Review before sending</span>
              </div>
              <p className="text-sm text-slate-700 leading-relaxed mb-3 bg-white rounded-lg p-2.5 border border-violet-100 max-h-[120px] overflow-y-auto">
                {activeDraft}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (activeTicket) {
                      addBotMessage(activeTicket.id, activeDraft);
                      clearDraftReply(activeTicket.id);
                      toast.success('Draft sent as AI Auto-Reply');
                    }
                  }}
                  className="text-[11px] font-medium px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-colors flex items-center gap-1"
                >
                  <Send size={11} /> Send as-is
                </button>
                <button
                  onClick={() => {
                    setReplyText(activeDraft);
                    if (activeTicket) clearDraftReply(activeTicket.id);
                    toast.info('Draft moved to compose box — edit and send when ready');
                  }}
                  className="text-[11px] font-medium px-3 py-1.5 rounded-lg bg-white border border-violet-200 text-violet-700 hover:bg-violet-50 transition-colors flex items-center gap-1"
                >
                  <FileEdit size={11} /> Edit first
                </button>
                <button
                  onClick={() => {
                    if (activeTicket) clearDraftReply(activeTicket.id);
                    toast('Draft discarded');
                  }}
                  className="text-[11px] font-medium px-3 py-1.5 rounded-lg text-slate-400 hover:text-red-500 transition-colors flex items-center gap-1"
                >
                  <X size={11} /> Discard
                </button>
              </div>
            </div>
          )}
          {guestMode && (
            <div className="flex items-center gap-2 mb-2 animate-in fade-in duration-150">
              <UserCircle size={12} className="text-emerald-600" />
              <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">
                Chatting as {activeTicket.guestName}
              </span>
              <span className="text-[10px] text-emerald-500">Messages appear as the guest</span>
            </div>
          )}
          <textarea
            ref={(el) => {
              if (el) {
                el.style.height = 'auto';
                el.style.height = `${Math.min(el.scrollHeight, isMobile ? 120 : 220)}px`;
              }
            }}
            value={replyText}
            onChange={(e) => {
              setReplyText(e.target.value);
              const el = e.target;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, isMobile ? 120 : 220)}px`;
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              guestMode
                ? `Chat as ${activeTicket.guestName.split(' ')[0]}...`
                : `Reply to ${activeTicket.guestName.split(' ')[0]}... (${navigator.platform.includes('Mac') ? '\u2318' : 'Ctrl'}+Enter)`
            }
            className={`w-full rounded-xl ${isMobile ? 'p-2.5 text-[13px] min-h-[48px] max-h-[120px]' : 'p-3 text-sm min-h-[72px] max-h-[220px]'} focus:outline-none resize-none transition-colors ${
              guestMode
                ? 'border-2 border-emerald-300 bg-white focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 placeholder:text-emerald-400'
                : 'border border-slate-200 bg-slate-50/60 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-300 placeholder:text-slate-400'
            }`}
          />
          <div className="flex items-center justify-between mt-1.5 gap-2">
            <div className="flex items-center gap-1.5 text-[10px] text-slate-400 min-w-0 overflow-hidden">
              {guestMode ? (
                <span className="flex items-center gap-1 bg-emerald-100 px-1.5 py-0.5 rounded shrink-0">
                  <UserCircle size={9} className="text-emerald-500 shrink-0" />
                  <span className="font-medium text-emerald-700 text-[9px]">{activeTicket.guestName.split(' ')[0]}</span>
                </span>
              ) : (
                <span className="flex items-center gap-1 bg-slate-100 px-1.5 py-0.5 rounded truncate">
                  <span className="font-medium text-slate-500 text-[9px] truncate">{activeTicket.host.name}</span>
                  {!isMobile && (
                    <span className="text-slate-400 text-[8px] shrink-0">{activeTicket.host.tone}</span>
                  )}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={toggleGuestMode}
                className={`text-[10px] font-medium px-2 py-1 rounded-md flex items-center gap-1 transition-colors border ${
                  guestMode
                    ? 'text-emerald-700 bg-emerald-100 border-emerald-300 hover:bg-emerald-200'
                    : 'text-slate-400 bg-white border-slate-200 hover:text-emerald-600 hover:bg-emerald-50 hover:border-emerald-200'
                }`}
                title="Toggle guest mode"
              >
                <UserCircle size={11} /> {!isMobile && 'Guest'}
              </button>

              {!guestMode && (
                <button
                  onClick={toggleSmartReply}
                  className={`text-[10px] font-medium px-2 py-1 rounded-md flex items-center gap-1 transition-colors border ${
                    showSmartReply
                      ? 'text-indigo-700 bg-indigo-100 border-indigo-300'
                      : 'text-indigo-600 bg-indigo-50 border-indigo-100 hover:bg-indigo-100'
                  }`}
                  title={`Smart Reply (${navigator.platform.includes('Mac') ? '\u2318' : 'Ctrl'}+Shift+A)`}
                >
                  <Sparkles size={11} /> {!isMobile && 'Smart Reply'}
                </button>
              )}

              <button
                onClick={handleSendMessage}
                disabled={!replyText.trim()}
                className={`px-2.5 py-1 rounded-md shadow-sm transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1 text-[10px] font-medium ${
                  guestMode
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700'
                }`}
              >
                <Send size={11} /> Send
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Right resize handle (desktop only, when not collapsed) */}
      {!isMobile && !rightCollapsed && (
        <div
          className={`w-px shrink-0 cursor-col-resize relative group z-20 transition-colors ${resizing === 'right' ? 'bg-indigo-400' : 'bg-slate-200 hover:bg-indigo-400'}`}
          onMouseDown={(e) => { e.preventDefault(); setResizing('right'); }}
          onDoubleClick={() => setRightWidth(320)}
          title="Drag to resize • Double-click to reset"
        >
          <div className="absolute inset-y-0 -left-2 -right-2" />
        </div>
      )}

      {/* Right overlay backdrop (for narrow screens) */}
      {!isMobile && rightCollapsed && rightOverlayOpen && (
        <div
          className="absolute inset-0 z-40 bg-black/10"
          onClick={() => setRightOverlayOpen(false)}
        />
      )}

      {/* Right Context Pane */}
      <div
        className={`${
          isMobile
            ? (showMobileDetails ? 'fixed inset-0 z-50 w-full animate-in slide-in-from-right duration-200' : 'hidden')
            : rightCollapsed
              ? (rightOverlayOpen ? 'flex absolute right-0 top-0 bottom-0 z-50 shadow-2xl rounded-l-xl animate-in slide-in-from-right duration-200' : 'hidden')
              : 'flex shrink-0 overflow-hidden'
        } bg-white border-l border-slate-200 flex flex-col`}
        style={!isMobile ? { width: rightCollapsed && rightOverlayOpen ? Math.min(rightWidth, 380) : rightCollapsed ? 0 : displayRightWidth, minWidth: rightCollapsed ? 0 : RIGHT_MIN, transition: resizing ? 'none' : 'width 0.2s ease' } : undefined}
      >
        <div className={`p-3 border-b flex items-center justify-between shrink-0 ${activeTicket.status === 'urgent' ? 'bg-red-50 border-red-200' : activeTicket.status === 'warning' ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
          <div className="flex items-center gap-2">
            {isMobile && (
              <button onClick={() => setShowMobileDetails(false)} className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:bg-slate-200 transition-colors">
                <ArrowLeft size={16} />
              </button>
            )}
            {!isMobile && rightCollapsed && rightOverlayOpen && (
              <button onClick={() => setRightOverlayOpen(false)} className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:bg-slate-200 transition-colors">
                <X size={14} />
              </button>
            )}
            <Clock size={14} className={activeTicket.status === 'urgent' ? 'text-red-500' : activeTicket.status === 'warning' ? 'text-amber-500' : 'text-slate-400'} />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">SLA</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-lg font-bold tabular-nums ${activeTicket.status === 'urgent' ? 'text-red-600' : activeTicket.status === 'warning' ? 'text-amber-600' : 'text-slate-700'}`}>
              {activeTicket.sla}
            </span>
            {/* #12: De-escalation button — lets agent downgrade urgency */}
            {activeTicket.status !== 'normal' && (
              <button
                onClick={() => {
                  deescalateTicket(activeTicket.id);
                  toast.success('De-escalated to normal', { description: `${activeTicket.guestName}'s ticket priority lowered.` });
                }}
                className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-slate-200 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 hover:border-emerald-200 transition-colors uppercase tracking-wider"
                title="De-escalate to normal priority"
              >
                <ArrowDown size={9} className="inline mr-0.5" /> De-escalate
              </button>
            )}
          </div>
        </div>

        <div className="flex border-b border-slate-200 shrink-0">
          <button
            onClick={() => setRightTab('assistant')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-bold transition-colors relative ${
              rightTab === 'assistant'
                ? 'text-indigo-600'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <Sparkles size={12} /> Research
            {rightTab === 'assistant' && (
              <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-indigo-600 rounded-full" />
            )}
          </button>
          <button
            onClick={() => setRightTab('details')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-bold transition-colors relative ${
              rightTab === 'details'
                ? 'text-indigo-600'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <User size={12} /> Details
            {rightTab === 'details' && (
              <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-indigo-600 rounded-full" />
            )}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {rightTab === 'assistant' ? (
            <AssistantPanel
              ticket={activeTicket}
              onComposeReply={handleComposeReply}
              onNavigateToKB={(propId) => navigate(`/kb/${propId}`)}
            />
          ) : (
            <div>
              <div className="p-5 border-b border-slate-100">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2"><User size={14} /> Guest & Booking</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div><span className="block text-[10px] text-slate-400 mb-0.5">Check-in</span><span className="text-sm font-medium">{activeTicket.booking.checkIn}</span></div>
                  <div><span className="block text-[10px] text-slate-400 mb-0.5">Check-out</span><span className="text-sm font-medium">{activeTicket.booking.checkOut}</span></div>
                  <div><span className="block text-[10px] text-slate-400 mb-0.5">Guests</span><span className="text-sm font-medium flex items-center gap-1"><Users size={12} /> {activeTicket.booking.guests}</span></div>
                  <div><span className="block text-[10px] text-slate-400 mb-0.5">Status</span><span className="text-sm font-medium">{activeTicket.booking.status}</span></div>
                </div>
              </div>

              <div className="p-5 border-b border-slate-100">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2"><Tag size={14} /> Ticket Details</h3>
                <div className="space-y-3">
                  <div>
                    <span className="block text-[10px] text-slate-400 mb-1">Channel</span>
                    <span className="text-sm font-medium flex items-center gap-1.5">
                      <activeTicket.channelIcon size={14} className="text-slate-500" /> {activeTicket.channel}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-slate-400 mb-1">Language</span>
                    <span className="text-sm font-medium flex items-center gap-1.5">
                      <Globe2 size={14} className="text-slate-500" /> {activeTicket.language}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-slate-400 mb-1">AI Handover Reason</span>
                    <p className="text-sm text-slate-700 leading-relaxed bg-slate-50 p-2 rounded-md border border-slate-100">{activeTicket.aiHandoverReason}</p>
                  </div>
                  <div>
                    <span className="block text-[10px] text-slate-400 mb-1">Tags</span>
                    <div className="flex flex-wrap gap-1">
                      {activeTicket.tags.map(tag => (
                        <span key={tag} className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full border border-indigo-100 flex items-center gap-1">
                          <Tag size={8} /> {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-5">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2"><Briefcase size={14} /> Host</h3>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-lg ${activeTicket.host.brandColor} flex items-center justify-center text-white font-bold text-sm`}>
                      {activeTicket.host.name.charAt(0)}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-700">{activeTicket.host.name}</p>
                      <p className="text-[10px] text-slate-400">Tone: {activeTicket.host.tone}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={showResolveConfirm}
        title="Resolve this ticket?"
        description={`This will close ${activeTicket.guestName}'s ticket (${activeTicket.id}) and remove it from the active queue. This action cannot be undone.`}
        confirmLabel="Resolve Ticket"
        cancelLabel="Keep Open"
        variant="warning"
        onConfirm={() => { setShowResolveConfirm(false); handleResolve(); }}
        onCancel={() => setShowResolveConfirm(false)}
      />

      {/* Delete thread confirmation */}
      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete this thread?"
        description={`This will permanently remove ${activeTicket.guestName}'s entire conversation (${activeTicket.messages.length} messages). This action cannot be undone.`}
        confirmLabel="Delete Thread"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => {
          setShowDeleteConfirm(false);
          const deletedId = activeTicket.id;
          const nextTicket = filteredTickets.find(t => t.id !== deletedId);
          // Cancel any in-progress AI processing for this thread
          cancelAutoReply(deletedId);
          setShowCancelMenu(false);
          deleteThread(deletedId);
          toast.success('Thread deleted', { description: `${activeTicket.guestName}'s conversation removed.` });
          if (nextTicket) {
            navigate(`/inbox/${nextTicket.id}`);
          } else {
            navigate('/inbox');
            if (isMobile) setMobilePanel('list');
          }
        }}
        onCancel={() => setShowDeleteConfirm(false)}
      />



      {/* Cancel AI menu — pause or skip */}
      <AnimatePresence>
        {showCancelMenu && (
          <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/20" onClick={() => setShowCancelMenu(false)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="bg-white rounded-xl shadow-2xl border border-slate-200 p-5 w-[340px]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="bg-violet-100 p-2 rounded-lg">
                  <Bot size={16} className="text-violet-600" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">AI reply stopped</h3>
                  <p className="text-[11px] text-slate-500">What would you like to do?</p>
                </div>
              </div>
              
              <div className="space-y-2">
                <button
                  onClick={() => {
                    setShowCancelMenu(false);
                    toast.info('Skipped this time', { description: 'AI will still review the next guest message in this thread.' });
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors group"
                >
                  <div className="flex items-center gap-2.5">
                    <SkipForward size={14} className="text-slate-400 group-hover:text-indigo-500 transition-colors" />
                    <div>
                      <span className="text-sm font-medium text-slate-700">Skip this time only</span>
                      <p className="text-[10px] text-slate-400">AI will review the next guest message normally</p>
                    </div>
                  </div>
                </button>
                
                <button
                  onClick={() => {
                    toggleAutoReplyPause(activeTicket.id);
                    setShowCancelMenu(false);
                    toast.warning('AI paused for this thread', {
                      description: `Auto-reply paused for ${activeTicket.guestName}. Click the status chip to re-enable.`,
                      duration: 6000,
                      action: {
                        label: 'Resume',
                        onClick: () => toggleAutoReplyPause(activeTicket.id),
                      },
                    });
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-lg border border-amber-200 bg-amber-50/50 hover:bg-amber-50 transition-colors group"
                >
                  <div className="flex items-center gap-2.5">
                    <PauseCircle size={14} className="text-amber-500" />
                    <div>
                      <span className="text-sm font-medium text-amber-800">Pause AI for this thread</span>
                      <p className="text-[10px] text-amber-600">No AI replies until you re-enable from the status chip</p>
                    </div>
                  </div>
                </button>
              </div>
              
              <button
                onClick={() => setShowCancelMenu(false)}
                className="mt-3 w-full text-center text-[11px] text-slate-400 hover:text-slate-600 transition-colors py-1"
              >
                Dismiss
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="fixed z-[9999] animate-in fade-in zoom-in-95 duration-100"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <div className="bg-white rounded-lg shadow-xl border border-slate-200 py-1 min-w-[180px] overflow-hidden">
            <div className="px-3 py-1.5 border-b border-slate-100">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                {ctxMenu.senderType === 'guest' ? activeTicket.guestName
                  : ctxMenu.senderType === 'bot' ? 'AI Auto-Reply'
                  : ctxMenu.senderType === 'host' ? activeTicket.host.name
                  : agentName}
              </span>
            </div>

            <button
              onClick={() => {
                navigator.clipboard.writeText(ctxMenu.msgText);
                toast.success('Copied to clipboard');
                setCtxMenu(null);
              }}
              className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors"
            >
              <Copy size={14} className="text-slate-400" />
              Copy text
            </button>

            <button
              onClick={() => {
                const senderLabel = ctxMenu.senderType === 'bot' ? 'AI auto-reply'
                  : ctxMenu.senderType === 'guest' ? 'guest message'
                  : ctxMenu.senderType === 'host' ? 'host message'
                  : 'agent message';
                scheduleDelete(activeTicket.id, ctxMenu.msgId, senderLabel);
                setCtxMenu(null);
              }}
              className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2.5 transition-colors"
            >
              <Trash2 size={14} />
              Delete message
            </button>
          </div>
        </div>
      )}
    </div>
  );
}