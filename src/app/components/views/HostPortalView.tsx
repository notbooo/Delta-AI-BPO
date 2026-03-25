import { useState, useMemo, useRef, useEffect } from 'react';
import { useParams } from 'react-router';
import {
  Check, CheckCircle2, ChevronRight, ChevronLeft, ChevronDown,
  ClipboardList, HelpCircle, Lock, MapPin, MessageCircle,
  Shield, Sparkles, Wifi, Home, Recycle,
  Utensils, BedDouble, Phone, Send, Building,
  Camera, DollarSign, ImageIcon, Save, ArrowUp, Circle
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { MOCK_HOSTS } from '../../data/mock-data';
import { useAppContext } from '../../context/AppContext';
import type { OnboardingSection, OnboardingField } from '../../data/onboarding-template';

const SECTION_ICONS: Record<string, React.ReactNode> = {
  basics: <MapPin size={18} />,
  access: <Lock size={18} />,
  checkinout: <ClipboardList size={18} />,
  emergency: <Phone size={18} />,
  wifi: <Wifi size={18} />,
  rules: <Shield size={18} />,
  amenities: <Utensils size={18} />,
  nearby: <Home size={18} />,
  waste: <Recycle size={18} />,
  pricing: <DollarSign size={18} />,
  photos: <Camera size={18} />,
  roomPhotos: <ImageIcon size={18} />,
  faqs: <MessageCircle size={18} />,
  rooms: <BedDouble size={18} />,
};

export function HostPortalView() {
  const { propertyId, token } = useParams();
  const { properties, onboardingData, setOnboardingField, formTemplate } = useAppContext();
  const ONBOARDING_SECTIONS = formTemplate;

  const prop = properties.find(p => p.id === propertyId);
  const host = prop ? MOCK_HOSTS.find(h => h.id === prop.hostId) : null;
  const isActive = prop?.status === 'Active';
  const isValidToken = prop?.portalToken === token || prop?.internalPortalToken === token;
  const isInternalAccess = prop?.internalPortalToken === token;

  // Filter out sections marked as internal-only
  const visibleSections = useMemo(() =>
    ONBOARDING_SECTIONS.filter(s => !s.hostHidden),
    [ONBOARDING_SECTIONS]
  );

  const [activeIndex, setActiveIndex] = useState(0);
  const [activeRoomTab, setActiveRoomTab] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [showSectionPicker, setShowSectionPicker] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [direction, setDirection] = useState(0); // -1 = back, 1 = forward

  const formData = onboardingData[propertyId || ''] || {};
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const setField = (key: string, value: string) => {
    if (propertyId) {
      setOnboardingField(propertyId, key, value);
      setSaveStatus('saving');
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => setSaveStatus('saved'), 600);
    }
  };

  const roomLabels = useMemo(() => {
    if (!prop) return [];
    if (prop.roomNames && prop.roomNames.length > 0) return prop.roomNames;
    if (prop.units === 1) return ['Entire Property'];
    return Array.from({ length: prop.units }, (_, i) => `Unit ${i + 1}`);
  }, [prop]);

  const currentSection = visibleSections[activeIndex] || visibleSections[0];

  // Section completion tracking
  const sectionCompletion = useMemo(() => {
    const result: Record<string, { filled: number; total: number }> = {};
    const internalFields = new Set(['ownerName', 'ownerPhone', 'ownerEmail', 'ownerMessaging', 'ownerAvailability', 'repairName', 'repairPhone', 'repairNotes', 'cleaningName', 'cleaningPhone', 'cleaningNotes', 'smartLockId', 'onsiteResponseName', 'onsiteResponsePhone', 'onsiteResponseNotes', 'condoMgmtName', 'condoMgmtPhone', 'condoMgmtNotes', 'pestControlName', 'pestControlPhone']);
    for (const section of visibleSections) {
      if (section.id === 'faqs') {
        result[section.id] = { filled: 0, total: 0 };
        continue;
      }
      if (section.perRoom) {
        let filled = 0;
        let total = 0;
        for (let r = 0; r < roomLabels.length; r++) {
          for (const field of section.fields) {
            if (internalFields.has(field.id) || field.hostHidden) continue;
            total++;
            const key = `${section.id}__room${r}__${field.id}`;
            if (formData[key]?.trim()) filled++;
          }
        }
        result[section.id] = { filled, total };
      } else {
        let filled = 0;
        let total = 0;
        for (const field of section.fields) {
          if (internalFields.has(field.id) || field.hostHidden) continue;
          total++;
          const key = `${section.id}__${field.id}`;
          if (formData[key]?.trim()) filled++;
        }
        result[section.id] = { filled, total };
      }
    }
    return result;
  }, [formData, visibleSections, roomLabels]);

  const overallProgress = useMemo(() => {
    let filled = 0;
    let total = 0;
    for (const c of Object.values(sectionCompletion)) {
      filled += c.filled;
      total += c.total;
    }
    return total > 0 ? Math.round((filled / total) * 100) : 0;
  }, [sectionCompletion]);

  const goTo = (idx: number) => {
    setDirection(idx > activeIndex ? 1 : -1);
    setActiveIndex(idx);
    setActiveRoomTab(0);
    setShowSectionPicker(false);
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goNext = () => {
    if (activeIndex < visibleSections.length - 1) goTo(activeIndex + 1);
  };

  const goPrev = () => {
    if (activeIndex > 0) goTo(activeIndex - 1);
  };

  const handleSubmit = () => {
    setSubmitted(true);
    toast.success('Changes saved successfully', {
      description: isActive
        ? 'Your updates are live and the AI is already using the latest info.'
        : 'Your property team will review and apply your updates.',
    });
  };

  // Auto-hide save indicator
  useEffect(() => {
    if (saveStatus === 'saved') {
      const t = setTimeout(() => setSaveStatus('idle'), 2000);
      return () => clearTimeout(t);
    }
  }, [saveStatus]);

  // ─── Invalid state ──────────────────────────────────────
  if (!prop || !host || !isValidToken) {
    return (
      <div className="min-h-[100dvh] bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Building size={28} className="text-slate-300" />
          </div>
          <h2 className="font-bold text-slate-800 mb-2 text-lg">Invalid or Expired Link</h2>
          <p className="text-sm text-slate-500 leading-relaxed">This link is no longer valid. Please contact your property management team for a new one.</p>
        </div>
      </div>
    );
  }

  // ─── Submitted state ────────────────────────────────────
  if (submitted) {
    return (
      <div className="min-h-[100dvh] bg-slate-50 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center max-w-sm bg-white rounded-2xl shadow-lg p-8"
        >
          <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={36} className="text-green-500" />
          </div>
          <h2 className="font-bold text-slate-800 mb-2 text-lg">All Done!</h2>
          <p className="text-sm text-slate-500 mb-4 leading-relaxed">
            Thank you for updating <span className="font-semibold text-slate-700">{prop.name}</span>.
            {isActive
              ? ' Your changes are live — the AI is already using the latest info.'
              : ' Your management team has been notified.'}
          </p>
          <p className="text-xs text-slate-400">You can close this page or use the same link to make more changes anytime.</p>
          <button
            onClick={() => setSubmitted(false)}
            className="mt-5 text-sm text-blue-600 font-medium hover:underline"
          >
            Make more changes
          </button>
        </motion.div>
      </div>
    );
  }

  // ─── Internal field filter ──────────────────────────────
  const internalFields = new Set(['ownerName', 'ownerPhone', 'ownerEmail', 'ownerMessaging', 'ownerAvailability', 'repairName', 'repairPhone', 'repairNotes', 'cleaningName', 'cleaningPhone', 'cleaningNotes', 'smartLockId', 'onsiteResponseName', 'onsiteResponsePhone', 'onsiteResponseNotes', 'condoMgmtName', 'condoMgmtPhone', 'condoMgmtNotes', 'pestControlName', 'pestControlPhone']);

  const renderField = (field: OnboardingField, keyPrefix: string) => {
    const key = `${keyPrefix}__${field.id}`;
    const value = formData[key] || '';
    const baseClasses = 'w-full border border-slate-200 rounded-xl text-[16px] py-3 px-4 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 outline-none transition-all bg-white placeholder:text-slate-300';

    return (
      <div key={field.id} className={field.half ? 'flex-1 min-w-0' : 'w-full'}>
        <label className="block text-xs font-bold text-slate-600 mb-2 flex items-center gap-1.5">
          {field.label}
          {field.required && <span className="text-red-400 text-sm">*</span>}
          {field.helpText && (
            <span className="group relative">
              <HelpCircle size={13} className="text-slate-300 hover:text-blue-400 cursor-help" />
              <span className="absolute left-0 bottom-full mb-1.5 w-64 bg-slate-800 text-white text-[11px] p-2.5 rounded-xl shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 leading-relaxed">
                {field.helpText}
              </span>
            </span>
          )}
        </label>
        {field.type === 'textarea' ? (
          <textarea value={value} onChange={(e) => setField(key, e.target.value)} placeholder={field.placeholder}
            className={`${baseClasses} resize-none min-h-[100px]`} rows={4} />
        ) : field.type === 'select' ? (
          <select value={value} onChange={(e) => setField(key, e.target.value)} className={baseClasses}>
            <option value="">Select...</option>
            {field.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        ) : field.type === 'toggle' ? (
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={() => setField(key, value === 'true' ? 'false' : 'true')}
              className={`relative w-12 h-7 rounded-full transition-colors ${value === 'true' ? 'bg-blue-600' : 'bg-slate-300'}`}
            >
              <div className={`absolute top-[3px] w-[22px] h-[22px] bg-white rounded-full shadow transition-transform pointer-events-none ${value === 'true' ? 'left-[25px]' : 'left-[3px]'}`} />
            </button>
            <span className="text-sm text-slate-600 font-medium">{value === 'true' ? 'Yes' : 'No'}</span>
          </div>
        ) : (
          <input
            type={field.type === 'phone' ? 'tel' : field.type === 'url' ? 'url' : field.type === 'number' ? 'number' : field.type === 'time' ? 'time' : 'text'}
            value={value} onChange={(e) => setField(key, e.target.value)} placeholder={field.placeholder}
            className={baseClasses}
          />
        )}
      </div>
    );
  };

  const renderFieldGroup = (fields: OnboardingField[], keyPrefix: string) => {
    const elements: React.ReactNode[] = [];
    let i = 0;
    while (i < fields.length) {
      if (internalFields.has(fields[i].id) || fields[i].hostHidden) {
        i++;
        continue;
      }
      if (fields[i].group) {
        elements.push(
          <div key={`group-${fields[i].group}`} className="pt-5 pb-1 first:pt-0">
            <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 pb-2">{fields[i].group}</h4>
          </div>
        );
      }
      if (fields[i].half && i + 1 < fields.length && fields[i + 1].half) {
        if (internalFields.has(fields[i + 1].id) || fields[i + 1].hostHidden) {
          elements.push(renderField(fields[i], keyPrefix));
          i += 2;
        } else {
          elements.push(
            <div key={`pair-${fields[i].id}`} className="flex gap-3">
              {renderField(fields[i], keyPrefix)}
              {renderField(fields[i + 1], keyPrefix)}
            </div>
          );
          i += 2;
        }
      } else {
        elements.push(renderField(fields[i], keyPrefix));
        i++;
      }
    }
    return elements;
  };

  const renderSectionContent = (section: OnboardingSection) => {
    if (section.id === 'faqs') {
      return (
        <div className="text-center py-10 text-slate-400">
          <MessageCircle size={36} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium text-slate-500">FAQs are managed by your property team</p>
          <p className="text-xs mt-1.5 text-slate-400 leading-relaxed">Contact us if you'd like to add or update frequently asked questions.</p>
        </div>
      );
    }

    if (section.perRoom && roomLabels.length > 0) {
      return (
        <div className="space-y-5">
          {roomLabels.length > 1 && (
            <div className="flex gap-1.5 p-1 bg-slate-100 rounded-xl overflow-x-auto -mx-1 px-1 scrollbar-none">
              {roomLabels.map((label, idx) => (
                <button key={idx} onClick={() => setActiveRoomTab(idx)}
                  className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5 shrink-0 ${
                    activeRoomTab === idx ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 active:bg-slate-200'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="space-y-5">
            {renderFieldGroup(section.fields, `${section.id}__room${activeRoomTab}`)}
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-5">
        {renderFieldGroup(section.fields, section.id)}
      </div>
    );
  };

  const currentCompletion = sectionCompletion[currentSection.id];
  const currentPct = currentCompletion && currentCompletion.total > 0
    ? Math.round((currentCompletion.filled / currentCompletion.total) * 100)
    : 0;

  return (
    <div className="min-h-[100dvh] bg-slate-50 flex flex-col">
      {/* ─── Sticky Header ─────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-30 safe-area-top">
        <div className="max-w-[1366px] mx-auto">
        {/* Property info bar */}
        <div className="px-4 sm:px-6 pt-3 pb-2 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-inner bg-gradient-to-br from-blue-500 to-blue-700 shrink-0">
            {prop.name.charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-bold text-slate-800 text-sm truncate">{prop.name}</h1>
            <p className="text-[10px] text-slate-400 truncate">{prop.location}</p>
          </div>
          <AnimatePresence mode="wait">
            {saveStatus !== 'idle' && (
              <motion.div
                key={saveStatus}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full shrink-0 ${
                  saveStatus === 'saving' ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600'
                }`}
              >
                {saveStatus === 'saving' ? (
                  <><Save size={10} className="animate-pulse" /> Saving</>
                ) : (
                  <><Check size={10} /> Saved</>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Overall progress bar */}
        <div className="px-4 sm:px-6 pb-2">
          <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
            <span className="font-semibold">{overallProgress}% complete</span>
            <span>{activeIndex + 1} of {visibleSections.length}</span>
          </div>
          <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full"
              initial={false}
              animate={{ width: `${overallProgress}%` }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            />
          </div>
        </div>

        {/* Section picker button */}
        <button
          onClick={() => setShowSectionPicker(prev => !prev)}
          className="w-full flex items-center gap-2.5 px-4 sm:px-6 py-2.5 border-t border-slate-100 active:bg-slate-50 hover:bg-slate-50 transition-colors"
        >
          <div className="p-1.5 bg-blue-50 rounded-lg text-blue-600 shrink-0">
            {SECTION_ICONS[currentSection.id] || <Circle size={18} />}
          </div>
          <div className="flex-1 text-left min-w-0">
            <span className="text-sm font-bold text-slate-800 block truncate">{currentSection.title}</span>
            {currentCompletion && currentCompletion.total > 0 && (
              <span className="text-[10px] text-slate-400">
                {currentCompletion.filled}/{currentCompletion.total} fields filled
              </span>
            )}
          </div>
          <ChevronDown size={16} className={`text-slate-400 transition-transform ${showSectionPicker ? 'rotate-180' : ''}`} />
        </button>
        </div>
      </div>

      {/* ─── Section Picker Dropdown ───────────────────────── */}
      <AnimatePresence>
        {showSectionPicker && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/20 z-20"
              onClick={() => setShowSectionPicker(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="fixed left-0 right-0 top-[120px] z-30 mx-3 bg-white rounded-2xl shadow-xl border border-slate-200 max-h-[60vh] overflow-y-auto"
            >
              <div className="p-2">
                {visibleSections.map((section, idx) => {
                  const comp = sectionCompletion[section.id];
                  const pct = comp && comp.total > 0 ? Math.round((comp.filled / comp.total) * 100) : 0;
                  const isComplete = comp && comp.total > 0 && comp.filled === comp.total;
                  return (
                    <button
                      key={section.id}
                      onClick={() => goTo(idx)}
                      className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors ${
                        idx === activeIndex ? 'bg-blue-50' : 'active:bg-slate-50'
                      }`}
                    >
                      <div className={`p-1.5 rounded-lg shrink-0 ${
                        isComplete ? 'bg-green-50 text-green-600' :
                        idx === activeIndex ? 'bg-blue-100 text-blue-600' :
                        'bg-slate-100 text-slate-400'
                      }`}>
                        {isComplete ? <Check size={18} /> : (SECTION_ICONS[section.id] || <Circle size={18} />)}
                      </div>
                      <div className="flex-1 text-left min-w-0">
                        <span className={`text-sm font-semibold block truncate ${
                          idx === activeIndex ? 'text-blue-700' : 'text-slate-700'
                        }`}>
                          {section.title}
                        </span>
                        {comp && comp.total > 0 && (
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full transition-all ${isComplete ? 'bg-green-500' : 'bg-blue-400'}`} style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-[10px] text-slate-400 shrink-0">{comp.filled}/{comp.total}</span>
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ─── Form Content ──────────────────────────────────── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={currentSection.id}
            initial={{ opacity: 0, x: direction * 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -30 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="max-w-[1366px] mx-auto px-4 sm:px-6 lg:px-8 py-5"
          >
            {/* Section description */}
            <p className="text-xs text-slate-500 leading-relaxed mb-5 bg-blue-50/60 border border-blue-100 rounded-xl p-3 flex items-start gap-2">
              <Sparkles size={14} className="text-blue-400 mt-0.5 shrink-0" />
              <span>{currentSection.description}</span>
            </p>

            {/* Section progress chip */}
            {currentCompletion && currentCompletion.total > 0 && (
              <div className="flex items-center gap-2 mb-5">
                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full ${currentPct === 100 ? 'bg-green-500' : 'bg-blue-500'}`}
                    initial={false}
                    animate={{ width: `${currentPct}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
                <span className={`text-[10px] font-bold shrink-0 ${currentPct === 100 ? 'text-green-600' : 'text-slate-400'}`}>
                  {currentPct === 100 ? (
                    <span className="flex items-center gap-0.5"><Check size={10} /> Complete</span>
                  ) : (
                    `${currentCompletion.filled}/${currentCompletion.total}`
                  )}
                </span>
              </div>
            )}

            {/* Fields */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 lg:p-8 shadow-sm">
              {renderSectionContent(currentSection)}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ─── Bottom Navigation Bar ─────────────────────────── */}
      <div className="bg-white border-t border-slate-200 safe-area-bottom shrink-0">
        <div className="max-w-[1366px] mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <button
            onClick={goPrev}
            disabled={activeIndex === 0}
            className={`p-3 rounded-xl transition-colors ${
              activeIndex === 0
                ? 'text-slate-200 cursor-not-allowed'
                : 'text-slate-600 bg-slate-100 active:bg-slate-200'
            }`}
          >
            <ChevronLeft size={20} />
          </button>

          {/* Step dots */}
          <div className="flex-1 flex items-center justify-center gap-1 overflow-hidden">
            {visibleSections.map((s, i) => {
              const comp = sectionCompletion[s.id];
              const isComplete = comp && comp.total > 0 && comp.filled === comp.total;
              // Show compact dots: highlight a window of 7 around active
              const distance = Math.abs(i - activeIndex);
              if (distance > 3 && visibleSections.length > 9) return null;
              return (
                <button
                  key={s.id}
                  onClick={() => goTo(i)}
                  className={`rounded-full transition-all shrink-0 ${
                    i === activeIndex
                      ? 'w-6 h-2 bg-blue-500'
                      : isComplete
                        ? 'w-2 h-2 bg-green-400'
                        : 'w-2 h-2 bg-slate-200 active:bg-slate-300'
                  }`}
                />
              );
            })}
          </div>

          {activeIndex < visibleSections.length - 1 ? (
            <button
              onClick={goNext}
              className="p-3 rounded-xl bg-blue-600 text-white active:bg-blue-700 transition-colors shadow-sm"
            >
              <ChevronRight size={20} />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              className="px-5 py-3 rounded-xl bg-green-600 text-white text-sm font-bold active:bg-green-700 transition-colors shadow-sm flex items-center gap-2"
            >
              <Send size={16} /> Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}