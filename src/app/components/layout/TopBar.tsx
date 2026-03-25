import { useState, useRef, useEffect } from 'react';
import { Bell, Check, Keyboard, LogOut, Settings, User, Sparkles, TestTube2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { MOCK_HOSTS } from '../../data/mock-data';
import { useAppContext } from '../../context/AppContext';
import { ZoomControl } from './ZoomControl';

// Default values if context is unavailable (e.g. during HMR or error boundary recovery)
const CONTEXT_DEFAULTS = {
  activeHostFilter: 'all',
  setActiveHostFilter: (_v: string) => {},
  notifications: [] as any[],
  markNotificationRead: (_id: string) => {},
  markAllNotificationsRead: () => {},
  unreadCount: 0,
  agentName: 'Agent',
  hostSettings: [] as any[],
};

export function TopBar({ onShowShortcuts }: { onShowShortcuts?: () => void }) {
  let ctx: ReturnType<typeof useAppContext> | null = null;
  try {
    ctx = useAppContext();
  } catch {
    // Context not available — use safe defaults
  }
  const {
    activeHostFilter, setActiveHostFilter,
    notifications, markNotificationRead, markAllNotificationsRead,
    unreadCount, agentName, hostSettings,
  } = ctx ?? CONTEXT_DEFAULTS;
  const navigate = useNavigate();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotifications(false);
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setShowProfile(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="h-12 md:h-14 bg-slate-900 text-white flex items-center px-3 md:px-4 justify-between shrink-0 z-30 shadow-md safe-area-top">
      <div className="flex items-center gap-3 md:gap-6">
        <div className="flex items-center gap-2 font-bold text-base md:text-lg tracking-tight cursor-pointer" onClick={() => navigate('/inbox')}>
          <div className="w-7 h-7 md:w-8 md:h-8 bg-indigo-600 rounded flex items-center justify-center shadow-inner text-sm md:text-base">Δ</div>
          <span className="hidden sm:inline">Delta AI Ops</span>
        </div>
        <div className="w-px h-6 bg-slate-700 hidden md:block"></div>
        <div className="hidden md:flex items-center gap-3">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Client:</span>
          <select
            value={activeHostFilter}
            onChange={(e) => setActiveHostFilter(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-white text-sm rounded px-3 py-1 focus:ring-1 focus:ring-indigo-500 outline-none cursor-pointer hover:bg-slate-700 transition-colors"
          >
            <option value="all">All Host Companies</option>
            {MOCK_HOSTS.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {(hostSettings?.[0]?.demoFeatures?.showZoomOverride ?? true) && <ZoomControl />}

        {/* Notifications Dropdown */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => { setShowNotifications(!showNotifications); setShowProfile(false); }}
            className="text-slate-400 hover:text-white transition-colors relative p-1"
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 bg-red-500 rounded-full border border-slate-900 text-[9px] flex items-center justify-center px-1">
                {unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 top-10 w-80 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden z-50 text-slate-800">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <span className="text-sm font-bold text-slate-800">Notifications</span>
                {unreadCount > 0 && (
                  <button
                    onClick={markAllNotificationsRead}
                    className="text-[10px] font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                  >
                    <Check size={10} /> Mark all read
                  </button>
                )}
              </div>
              <div className="max-h-72 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="p-6 text-center text-sm text-slate-500">No notifications</div>
                ) : notifications.map(n => (
                  <div
                    key={n.id}
                    onClick={() => {
                      markNotificationRead(n.id);
                      if (n.type === 'ticket') navigate('/inbox');
                      if (n.type === 'task') navigate('/tasks');
                      setShowNotifications(false);
                    }}
                    className={`px-4 py-3 border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors ${!n.read ? 'bg-indigo-50/50' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs truncate ${!n.read ? 'font-bold text-slate-800' : 'font-medium text-slate-600'}`}>{n.title}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{n.message}</p>
                      </div>
                      {!n.read && <span className="w-2 h-2 bg-indigo-500 rounded-full shrink-0 mt-1"></span>}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">{n.time}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Profile Dropdown */}
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => { setShowProfile(!showProfile); setShowNotifications(false); }}
            className="flex items-center gap-2 pl-4 border-l border-slate-700 cursor-pointer hover:opacity-90 transition-opacity"
          >
            <div className="w-7 h-7 rounded-full bg-slate-300 border border-slate-600 overflow-hidden">
              <img src="https://api.dicebear.com/7.x/notionists/svg?seed=Felix" alt="Agent Profile" />
            </div>
            <span className="text-xs font-medium text-slate-300 hidden sm:block">{agentName}</span>
          </button>

          {showProfile && (
            <div className="absolute right-0 top-10 w-56 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden z-50 text-slate-800">
              <div className="px-4 py-3 border-b border-slate-100">
                <p className="text-sm font-bold text-slate-800">{agentName}</p>
                <p className="text-[11px] text-slate-500">felix@deltaaiops.com</p>
              </div>
              <div className="py-1">
                <button
                  onClick={() => { navigate('/settings'); setShowProfile(false); }}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-slate-50 flex items-center gap-3 text-slate-700"
                >
                  <Settings size={14} className="text-slate-400" /> Preferences
                </button>
                <button
                  onClick={() => { navigate('/settings/ai'); setShowProfile(false); }}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-slate-50 flex items-center gap-3 text-slate-700"
                >
                  <Sparkles size={14} className="text-slate-400" /> AI Auto-Reply
                </button>
                <button
                  onClick={() => { navigate('/guide'); setShowProfile(false); }}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-slate-50 flex items-center gap-3 text-slate-700"
                >
                  <TestTube2 size={14} className="text-slate-400" /> Test Guide
                </button>
                {onShowShortcuts && (
                  <button
                    onClick={() => { onShowShortcuts(); setShowProfile(false); }}
                    className="w-full px-4 py-2 text-left text-sm hover:bg-slate-50 flex items-center gap-3 text-slate-700"
                  >
                    <Keyboard size={14} className="text-slate-400" /> Shortcuts
                  </button>
                )}
              </div>
              <div className="border-t border-slate-100 py-1">
                <button className="w-full px-4 py-2 text-left text-sm hover:bg-red-50 flex items-center gap-3 text-red-600">
                  <LogOut size={14} /> Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}