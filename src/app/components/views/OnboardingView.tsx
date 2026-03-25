import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import {
  ArrowLeft, Check, CheckCircle2, ChevronRight, Circle,
  ClipboardList, HelpCircle, Lock, MapPin, MessageCircle,
  Plus, Rocket, Shield, ShieldCheck, Sparkles, Trash2,
  Wifi, Home, Recycle, Utensils, BedDouble,
  AlertTriangle, Phone, X, Upload, Loader2,
  Link2, Copy, Clock, Camera, DollarSign, CopyPlus,
  User, CalendarDays, ImageIcon, EyeOff, StickyNote, Pencil,
  Search, ChevronDown, Settings2, Share2
} from 'lucide-react';
import { toast } from 'sonner';
import { MOCK_HOSTS } from '../../data/mock-data';
import { useAppContext } from '../../context/AppContext';
import type { OnboardingSection, OnboardingField } from '../../data/onboarding-template';
import { importDocumentAI } from '../../ai/api-client';

const SECTION_ICONS: Record<string, React.ReactNode> = {
  basics: <MapPin size={16} />,
  access: <Lock size={16} />,
  checkinout: <ClipboardList size={16} />,
  emergency: <Phone size={16} />,
  wifi: <Wifi size={16} />,
  rules: <Shield size={16} />,
  amenities: <Utensils size={16} />,
  nearby: <Home size={16} />,
  waste: <Recycle size={16} />,
  pricing: <DollarSign size={16} />,
  photos: <Camera size={16} />,
  roomPhotos: <ImageIcon size={16} />,
  faqs: <MessageCircle size={16} />,
  rooms: <BedDouble size={16} />,
};

interface FAQItem {
  id: string;
  question: string;
  answer: string;
}

// Simulated AI extraction results for uploaded documents
const SIMULATED_EXTRACTIONS: Record<string, Record<string, string>> = {
  'property_info': {
    'basics__address': '456 Example Street, Suite 200',
    'basics__propertyType': 'Apartment',
    'basics__maxGuests': '4',
    'basics__numBedrooms': '2',
  },
  'access_guide': {
    'access__entryProcedure': 'Step 1: Enter building via the main entrance. Step 2: Take elevator to Floor 3. Step 3: Use code on smart lock.',
    'access__lockType': 'Smart Lock (Code)',
    'access__parkingInfo': 'Underground parking available. Spot B-12. Use gate remote in the key box.',
  },
  'house_rules': {
    'rules__smokingPolicy': 'No smoking indoors. Outdoor balcony only. Violation fee: $200.',
    'rules__quietHours': '10:00 PM to 8:00 AM. No parties.',
    'rules__petPolicy': 'Small dogs allowed with prior approval. $50 pet fee.',
  },
  'wifi_details': {
    'wifi__room0__networkName': 'PropertyWiFi_5G',
    'wifi__room0__wifiPassword': 'Welcome2024!',
    'wifi__room0__routerLocation': 'Living room TV cabinet',
  },
  'emergency_contacts': {
    'emergency__repairName': 'Quick Fix Home Services',
    'emergency__repairPhone': '+1 555-0123',
    'emergency__ownerName': 'Property Manager',
    'emergency__ownerPhone': '+1 555-0456',
    'emergency__nearestHospital': 'City General Hospital, 10 min drive. 24/7 ER.',
  },
};

// Helper: relative time from ISO string
function relativeTime(isoString: string): string {
  const now = new Date('2026-03-11T12:00:00Z'); // "today" per system prompt
  const then = new Date(isoString);
  const diffMs = now.getTime() - then.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 1) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return `${months} month${months > 1 ? 's' : ''} ago`;
  }
  const years = Math.floor(diffDays / 365);
  return `${years} year${years > 1 ? 's' : ''} ago`;
}

function isStaleSince(isoString: string): boolean {
  const now = new Date('2026-03-11T12:00:00Z');
  const then = new Date(isoString);
  const diffMs = now.getTime() - then.getTime();
  return diffMs > 90 * 24 * 60 * 60 * 1000; // >90 days = stale
}

export function OnboardingView() {
  const { propertyId } = useParams();
  const navigate = useNavigate();
  const {
    properties, onboardingData, setOnboardingField, setOnboardingBulk,
    formPersistStatus, manualSyncFormData,
    updatePropertyStatus, updatePropertyMeta,
    customFormSections, addCustomFormSection, removeCustomFormSection, renameCustomFormSection,
    formTemplate, formPhases,
    importAiModel,
  } = useAppContext();

  // Use mutable form template from context instead of static import
  const ONBOARDING_SECTIONS = formTemplate;
  const PHASE_1_SECTIONS = useMemo(() => formTemplate.filter(s => s.phase === 1), [formTemplate]);

  // Dynamic phase grouping for all defined phases
  const sectionsByPhase = useMemo(() => {
    const map: Record<number, typeof formTemplate> = {};
    for (const s of formTemplate) {
      if (!map[s.phase]) map[s.phase] = [];
      map[s.phase].push(s);
    }
    return map;
  }, [formTemplate]);

  const prop = properties.find(p => p.id === propertyId);
  const host = prop ? MOCK_HOSTS.find(h => h.id === prop.hostId) : null;

  const isOnboarding = prop?.status === 'Onboarding';
  const isActive = prop?.status === 'Active';
  const hasBeenSynced = isActive;

  const [activeSection, setActiveSection] = useState(ONBOARDING_SECTIONS[0].id);
  const [activeRoomTab, setActiveRoomTab] = useState(0);
  const [faqs, setFaqs] = useState<FAQItem[]>([
    { id: '1', question: '', answer: '' },
  ]);
  const [showGoLiveConfirm, setShowGoLiveConfirm] = useState(false);
  const [showPortalLink, setShowPortalLink] = useState(false);
  const [docProcessing, setDocProcessing] = useState(false);
  const [importPreview, setImportPreview] = useState<{
    data: Record<string, string>;
    schema: Record<string, { label: string; type: string }>;
    fileName: string;
    faqs?: FAQItem[];
  } | null>(null);
  const [showAddCustomSection, setShowAddCustomSection] = useState(false);
  const [newCustomSectionTitle, setNewCustomSectionTitle] = useState('');
  const [editingCustomSectionId, setEditingCustomSectionId] = useState<string | null>(null);
  const [editingCustomSectionTitle, setEditingCustomSectionTitle] = useState('');

  // Sidebar search
  const [sidebarSearch, setSidebarSearch] = useState('');
  // Auto-save + sync indicator
  const [saveIndicator, setSaveIndicator] = useState<'idle' | 'saving' | 'saved' | 'synced'>('idle');
  // Collapsed metadata for active properties
  const [showMetadata, setShowMetadata] = useState(false);
  // First-time pipeline tooltip
  const [showPipelineGuide, setShowPipelineGuide] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const formData = onboardingData[propertyId || ''] || {};
  const propCustomSections = customFormSections[propertyId || ''] || [];

  // Persist FAQs to onboardingData whenever they change (flows into auto-save to Supabase)
  useEffect(() => {
    if (!propertyId) return;
    setOnboardingField(propertyId, 'faqs__items', JSON.stringify(faqs));
  }, [faqs, propertyId, setOnboardingField]);

  const setField = (key: string, value: string) => {
    if (propertyId) {
      setOnboardingField(propertyId, key, value);
      setSaveIndicator('saving');
      setTimeout(() => setSaveIndicator('saved'), 400);
    }
  };

  // Room labels
  const roomLabels = useMemo(() => {
    if (!prop) return [];
    if (prop.roomNames && prop.roomNames.length > 0) return prop.roomNames;
    if (prop.units === 1) return ['Entire Property'];
    return Array.from({ length: prop.units }, (_, i) => `Unit ${i + 1}`);
  }, [prop]);

  // Count of filled form fields for this property (used in header badge)
  const autoSyncedEntryCount = useMemo(() => {
    if (!propertyId) return 0;
    return Object.keys(onboardingData[propertyId] || {}).filter(k => !k.startsWith('faqs__items')).length;
  }, [propertyId, onboardingData]);

  // Calculate completion per section
  const sectionCompletion = useMemo(() => {
    const result: Record<string, { filled: number; required: number; total: number }> = {};
    for (const section of ONBOARDING_SECTIONS) {
      if (section.id === 'faqs') {
        const completeFaqs = faqs.filter(f => f.question.trim() && f.answer.trim()).length;
        result[section.id] = { filled: completeFaqs, required: 0, total: Math.max(1, faqs.length) };
        continue;
      }
      if (section.perRoom) {
        let filled = 0;
        let required = 0;
        let total = 0;
        for (let r = 0; r < roomLabels.length; r++) {
          for (const field of section.fields) {
            total++;
            if (field.required) required++;
            const key = `${section.id}__room${r}__${field.id}`;
            if (formData[key]?.trim()) filled++;
          }
        }
        result[section.id] = { filled, required, total };
      } else {
        let filled = 0;
        let required = 0;
        for (const field of section.fields) {
          if (field.required) required++;
          const key = `${section.id}__${field.id}`;
          if (formData[key]?.trim()) filled++;
        }
        result[section.id] = { filled, required, total: section.fields.length };
      }
    }
    return result;
  }, [formData, faqs, roomLabels]);

  const overallProgress = useMemo(() => {
    let filled = 0;
    let total = 0;
    for (const section of ONBOARDING_SECTIONS) {
      const c = sectionCompletion[section.id];
      if (c) { filled += c.filled; total += c.total; }
    }
    return total > 0 ? Math.round((filled / total) * 100) : 0;
  }, [sectionCompletion]);

  // Dynamic progress per phase
  const phaseProgress = useMemo(() => {
    const map: Record<number, number> = {};
    for (const phase of formPhases) {
      const sections = sectionsByPhase[phase.id] || [];
      let filled = 0;
      let total = 0;
      for (const section of sections) {
        const c = sectionCompletion[section.id];
        if (c) { filled += c.filled; total += c.total; }
      }
      map[phase.id] = total > 0 ? Math.round((filled / total) * 100) : 0;
    }
    return map;
  }, [sectionCompletion, formPhases, sectionsByPhase]);

  const isPhase1Complete = useMemo(() => {
    for (const section of PHASE_1_SECTIONS) {
      if (section.perRoom) {
        for (let r = 0; r < roomLabels.length; r++) {
          for (const field of section.fields) {
            if (field.required && !formData[`${section.id}__room${r}__${field.id}`]?.trim()) return false;
          }
        }
      } else {
        for (const field of section.fields) {
          if (field.required && !formData[`${section.id}__${field.id}`]?.trim()) return false;
        }
      }
    }
    return true;
  }, [formData, roomLabels]);

  const currentSection = ONBOARDING_SECTIONS.find(s => s.id === activeSection) || ONBOARDING_SECTIONS[0];
  const currentIndex = ONBOARDING_SECTIONS.findIndex(s => s.id === activeSection);
  const isCustomSection = activeSection.startsWith('_custom__');

  const goNext = () => {
    const nextIdx = currentIndex + 1;
    if (nextIdx < ONBOARDING_SECTIONS.length) {
      setActiveSection(ONBOARDING_SECTIONS[nextIdx].id);
      setActiveRoomTab(0);
    }
  };

  const goPrev = () => {
    const prevIdx = currentIndex - 1;
    if (prevIdx >= 0) {
      setActiveSection(ONBOARDING_SECTIONS[prevIdx].id);
      setActiveRoomTab(0);
    }
  };

  const addFaq = () => setFaqs(prev => [...prev, { id: String(Date.now()), question: '', answer: '' }]);
  const removeFaq = (id: string) => setFaqs(prev => prev.filter(f => f.id !== id));
  const updateFaq = (id: string, field: 'question' | 'answer', value: string) => {
    setFaqs(prev => prev.map(f => f.id === id ? { ...f, [field]: value } : f));
  };

  // Unified file import handler with AI mapping
  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !propertyId) return;

    try {
      setDocProcessing(true);

      // Read file content
      const fileContent = await readFileAsText(file);
      if (!fileContent) {
        throw new Error('Could not read file');
      }

      // Build form field schema for Claude
      const fieldSchema = buildFormFieldSchema(ONBOARDING_SECTIONS, prop?.units || 1);

      // Call Claude to map the data via server proxy (no client-side API key needed)
      const systemPrompt = `You are an AI that extracts property information from documents and maps it to structured form fields.
Respond ONLY with valid JSON (no markdown, no explanation).

Rules:
- Only include fields where you found a real value in the document. Omit fields with no data.
- For fields with type "select": the value MUST exactly match one of the listed options. If nothing matches, omit the field.
- For fields with type "time": use HH:MM 24-hour format (e.g. "15:00" for 3 PM, "11:00" for 11 AM). Never include text like "By" or "AM/PM".
- For fields with type "number": output digits only (e.g. "8" not "8 units").
- Do NOT copy placeholder examples from the schema as values.
- If the document contains a FAQ section with guest questions and answers, include them as "faqs": [{"question": "...", "answer": "..."}, ...]`;

      const toonSchema = schemaToTOON(fieldSchema);

      const userPrompt = `Extract property information from this document and map it to the form fields below.
File: "${file.name}"

Field schema (id: Label — with type hints: # = number, @time = HH:MM 24h, [A|B] = pick one exactly):
${toonSchema}

Document:
${fileContent.substring(0, 1000000)}

Output ONLY a JSON object. For regular fields use flat keys. For FAQs use a "faqs" array. Example:
{"basics__address": "123 Main St", "checkinout__checkinTime": "15:00", "faqs": [{"question": "Is there parking?", "answer": "Yes, one space is available."}]}`;

      const result = await importDocumentAI({
        model: importAiModel,
        systemPrompt,
        userPrompt,
        attachment: fileContent.substring(0, 1000000),
      });

      // Parse Claude's response — extract FAQs separately before field coercion
      let rawJson: any = {};
      try {
        const jsonMatch = result.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) rawJson = JSON.parse(jsonMatch[0]);
      } catch { /* ignore parse errors */ }

      const extractedFaqs: FAQItem[] = (rawJson.faqs || [])
        .filter((f: any) => f.question?.trim() && f.answer?.trim())
        .map((f: any, i: number) => ({ id: String(i + 1), question: f.question.trim(), answer: f.answer.trim() }));

      // Remove faqs from the object before field mapping
      delete rawJson.faqs;
      const mappedData = parseAIResponse(JSON.stringify(rawJson), fieldSchema);
      const fieldCount = Object.keys(mappedData).length + extractedFaqs.length;

      if (fieldCount === 0) {
        toast.warning('No data extracted', {
          description: 'Claude could not extract any recognizable property information from this file.',
        });
        setDocProcessing(false);
        return;
      }

      // Show preview before applying
      setDocProcessing(false);
      setImportPreview({ data: mappedData, schema: fieldSchema, fileName: file.name, faqs: extractedFaqs.length > 0 ? extractedFaqs : undefined });
    } catch (err: any) {
      console.error('File import error:', err);
      toast.error('Import failed', { description: err.message || 'Unknown error' });
      setDocProcessing(false);
    }

    e.target.value = '';
  };

  const confirmImport = () => {
    if (!importPreview || !propertyId) return;
    setOnboardingBulk(propertyId, importPreview.data);
    if (importPreview.faqs && importPreview.faqs.length > 0) {
      setFaqs(importPreview.faqs);
    }
    const fieldCount = Object.keys(importPreview.data).length + (importPreview.faqs?.length || 0);
    toast.success(`Imported ${fieldCount} fields from "${importPreview.fileName}"`, {
      description: isActive ? 'AI knowledge will update automatically.' : 'Form fields updated.',
    });
    setImportPreview(null);
  };

  // Open Go Live modal for first-time onboarding
  const openGoLiveConfirm = () => {
    setShowGoLiveConfirm(true);
  };

  // Portal links
  const portalUrl = prop?.portalToken
    ? `${window.location.origin}/host/${propertyId}/${prop.portalToken}`
    : null;

  const internalPortalUrl = prop?.internalPortalToken
    ? `${window.location.origin}/host/${propertyId}/${prop.internalPortalToken}`
    : null;

  const copyPortalLink = (url: string | null, isInternal = false) => {
    if (url) {
      // Try modern Clipboard API first
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(url)
          .then(() => toast.success(`${isInternal ? 'Internal' : 'Host'} portal link copied`))
          .catch(() => fallbackCopy(url));
      } else {
        // Fallback for non-secure contexts or unsupported browsers
        fallbackCopy(url);
      }
    }
  };

  const fallbackCopy = (text: string) => {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (success) {
        toast.success('Portal link copied to clipboard');
      } else {
        toast.error('Failed to copy to clipboard');
      }
    } catch (err) {
      toast.error('Clipboard access not available in this environment');
    }
  };

  // Go Live handler — first-time onboarding only. Sets property to Active + initial compose.
  const handleGoLive = () => {
    if (!prop || !host || !propertyId) return;

    updatePropertyStatus(propertyId, 'Active');
    updatePropertyMeta(propertyId, {
      portalToken: prop.portalToken || `${prop.name.toLowerCase().replace(/\s+/g, '-')}-${Math.random().toString(36).substring(2, 8)}`,
      internalPortalToken: prop.internalPortalToken || `internal-${Math.random().toString(36).substring(2, 12)}-${Math.random().toString(36).substring(2, 8)}`,
    });

    toast.success(`${prop.name} is now live!`, {
      description: `The AI will now answer guest questions about ${prop.name} using the form data. Edits auto-sync to Supabase.`,
    });

    setShowGoLiveConfirm(false);
    navigate(`/kb/${propertyId}`);
  };

  // Helper: Read file as text
  const readFileAsText = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string | ArrayBuffer;
          if (typeof content === 'string') {
            resolve(content);
          } else {
            // For binary formats like XLSX, try to parse as Excel or convert to text
            const buffer = content as ArrayBuffer;
            if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
              import('xlsx').then((XLSX) => {
                try {
                  const workbook = XLSX.read(buffer, { type: 'array' });
                  const allText: string[] = [];

                  // Process all sheets, stripping empty rows
                  for (const sheetName of workbook.SheetNames) {
                    const sheet = workbook.Sheets[sheetName];
                    const csv = XLSX.utils.sheet_to_csv(sheet);
                    const cleaned = csv.split('\n')
                      .filter(row => row.replace(/,/g, '').trim() !== '')
                      .join('\n');
                    if (cleaned.trim()) allText.push(`=== Sheet: ${sheetName} ===\n${cleaned}`);
                  }

                  resolve(allText.join('\n\n'));
                } catch (err) {
                  reject(err);
                }
              }).catch(reject);
            } else {
              // Fallback: convert to base64 or string
              const view = new Uint8Array(buffer);
              const text = String.fromCharCode(...view);
              resolve(text);
            }
          }
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));

      if (file.type.startsWith('image/')) {
        reader.readAsDataURL(file); // For images, use data URL
      } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        reader.readAsArrayBuffer(file);
      } else {
        reader.readAsText(file); // For text-based files
      }
    });
  };

  // Helper: Build form field schema for AI
  const buildFormFieldSchema = (sections: typeof ONBOARDING_SECTIONS, numRooms: number) => {
    type FieldMeta = { label: string; type: string; options?: string[]; format?: string };
    const schema: Record<string, FieldMeta> = {};

    const toMeta = (field: OnboardingField): FieldMeta => {
      const base: FieldMeta = { label: field.label, type: field.type };
      if (field.options?.length) base.options = field.options;
      if (field.type === 'time') base.format = 'HH:MM 24-hour (e.g. "15:00" for 3 PM)';
      if (field.type === 'number') base.format = 'digits only';
      return base;
    };

    for (const section of sections) {
      if (section.id === 'faqs' || section.id === 'photos' || section.id === 'roomPhotos') continue;
      if (section.perRoom) {
        for (let r = 0; r < numRooms; r++) {
          for (const field of section.fields) {
            schema[`${section.id}__room${r}__${field.id}`] = toMeta(field);
          }
        }
      } else {
        for (const field of section.fields) {
          schema[`${section.id}__${field.id}`] = toMeta(field);
        }
      }
    }
    return schema;
  };

  // Serialize schema to compact TOON format (saves ~60% tokens vs JSON)
  // Format: one line per field
  //   fieldId: Label              (text/textarea/phone/url)
  //   fieldId: Label #            (number — digits only)
  //   fieldId: Label @time        (time — HH:MM 24h)
  //   fieldId: Label [A|B|C]      (select — must match exactly)
  const schemaToTOON = (schema: Record<string, { label: string; type: string; options?: string[] }>): string =>
    Object.entries(schema).map(([id, m]) => {
      if (m.type === 'select' && m.options?.length) return `${id}: ${m.label} [${m.options.join('|')}]`;
      if (m.type === 'time') return `${id}: ${m.label} @time`;
      if (m.type === 'number') return `${id}: ${m.label} #`;
      return `${id}: ${m.label}`;
    }).join('\n');

  // Helper: Parse Claude's JSON response and coerce values to match field types
  const parseAIResponse = (responseText: string, schema?: Record<string, { type: string; options?: string[] }>): Record<string, string> => {
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn('No JSON found in response:', responseText);
        return {};
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const result: Record<string, string> = {};

      for (const [key, rawValue] of Object.entries(parsed)) {
        const value = String(rawValue ?? '').trim();
        if (!value) continue;

        const meta = schema?.[key];
        if (!meta) {
          result[key] = value;
          continue;
        }

        // Time fields: coerce "By 11:00 AM" → "11:00", "3:00 PM" → "15:00"
        if (meta.type === 'time') {
          const match = value.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
          if (match) {
            let h = parseInt(match[1], 10);
            const m = match[2];
            const period = (match[3] || '').toUpperCase();
            if (period === 'PM' && h < 12) h += 12;
            if (period === 'AM' && h === 12) h = 0;
            result[key] = `${String(h).padStart(2, '0')}:${m}`;
          }
          // If no valid time pattern found, omit the field
          continue;
        }

        // Select fields: value must exactly match one of the options (case-insensitive fallback)
        if (meta.type === 'select' && meta.options?.length) {
          const exact = meta.options.find(o => o === value);
          if (exact) {
            result[key] = exact;
          } else {
            // Case-insensitive match
            const ci = meta.options.find(o => o.toLowerCase() === value.toLowerCase());
            if (ci) result[key] = ci;
            // Otherwise omit — bad value
          }
          continue;
        }

        result[key] = value;
      }

      return result;
    } catch (err) {
      console.error('Failed to parse AI response:', err);
      return {};
    }
  };

  const applyDataCorrections = async () => {
    if (!propertyId) return;

    try {
      const { HIKARI_CORRECTIONS } = await import('../../utils/data-corrections');
      setOnboardingBulk(propertyId, HIKARI_CORRECTIONS);

      toast.success('Data fixed!', {
        description: `Applied ${Object.keys(HIKARI_CORRECTIONS).length} corrections — property name, Wi-Fi, parking, cleaning, waste, nearby info, OTAs.`,
      });

      console.log(`[Data Fix] Applied ${Object.keys(HIKARI_CORRECTIONS).length} corrections for ${propertyId}`);
    } catch (err) {
      console.error('Data correction error:', err);
      toast.error('Failed to apply corrections');
    }
  };

  if (!prop || !host) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <AlertTriangle size={48} className="mx-auto text-amber-400 mb-4" />
          <h2 className="font-bold text-slate-800 mb-2">Property Not Found</h2>
          <button onClick={() => navigate('/kb')} className="text-indigo-600 hover:underline text-sm">
            Back to Properties
          </button>
        </div>
      </div>
    );
  }

  const renderField = (field: OnboardingField, keyPrefix: string) => {
    const key = `${keyPrefix}__${field.id}`;
    const value = formData[key] || '';
    const inputClasses = 'w-full border border-slate-300 rounded-lg text-sm py-2.5 px-3 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 outline-none transition-colors bg-white placeholder:text-slate-300';

    return (
      <div key={field.id} className={field.half ? 'flex-1 min-w-0' : 'w-full'}>
        <label className="block text-xs font-bold text-slate-600 mb-1.5 flex items-center gap-1.5">
          {field.label}
          {field.required && <span className="text-red-400">*</span>}
          {field.hostHidden && (
            <span className="text-[9px] text-amber-600 bg-amber-50 px-1 py-0.5 rounded border border-amber-100 flex items-center gap-0.5" title="Hidden from host portal">
              <EyeOff size={8} /> Ops only
            </span>
          )}
          {field.helpText && (
            <span className="group relative">
              <HelpCircle size={12} className="text-slate-300 hover:text-indigo-400 cursor-help" />
              <span className="absolute left-0 bottom-full mb-1 w-64 bg-slate-800 text-white text-[10px] p-2 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                {field.helpText}
              </span>
            </span>
          )}
        </label>
        {field.type === 'textarea' ? (
          <textarea
            value={value}
            onChange={(e) => setField(key, e.target.value)}
            placeholder={field.placeholder}
            className={`${inputClasses} resize-none min-h-[80px]`}
            rows={3}
          />
        ) : field.type === 'select' ? (
          <select value={value} onChange={(e) => setField(key, e.target.value)} className={inputClasses}>
            <option value="">Select...</option>
            {field.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        ) : field.type === 'toggle' ? (
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => setField(key, value === 'true' ? 'false' : 'true')}
              className={`relative w-10 h-[22px] rounded-full transition-colors ${value === 'true' ? 'bg-indigo-600' : 'bg-slate-300'}`}
            >
              <div className={`absolute top-[3px] w-4 h-4 bg-white rounded-full shadow transition-transform pointer-events-none ${value === 'true' ? 'left-[21px]' : 'left-[3px]'}`} />
            </button>
            <span className="text-xs text-slate-500">{value === 'true' ? 'Yes' : 'No'}</span>
          </div>
        ) : (
          <input
            type={field.type === 'phone' ? 'tel' : field.type === 'url' ? 'url' : field.type === 'number' ? 'number' : field.type === 'time' ? 'time' : 'text'}
            value={value}
            onChange={(e) => setField(key, e.target.value)}
            placeholder={field.placeholder}
            className={inputClasses}
          />
        )}
      </div>
    );
  };

  const renderSectionContent = (section: OnboardingSection) => {
    if (section.id === 'faqs') {
      return (
        <div className="space-y-4">
          <p className="text-sm text-slate-500 bg-indigo-50 border border-indigo-100 rounded-lg p-3 flex items-start gap-2">
            <Sparkles size={16} className="text-indigo-400 mt-0.5 shrink-0" />
            <span>Add the questions guests ask most often. Each Q&A becomes an instant AI response — no manual replies needed.</span>
          </p>
          {faqs.map((faq, idx) => (
            <div key={faq.id} className="bg-white border border-slate-200 rounded-lg p-4 space-y-3 relative group">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-400 uppercase">FAQ #{idx + 1}</span>
                {faqs.length > 1 && (
                  <button onClick={() => removeFaq(faq.id)} className="text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Guest Question</label>
                <input type="text" value={faq.question} onChange={(e) => updateFaq(faq.id, 'question', e.target.value)}
                  placeholder="e.g. What clothes should I bring to Tokyo?"
                  className="w-full border border-slate-300 rounded-lg text-sm py-2.5 px-3 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 outline-none bg-white placeholder:text-slate-300" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Standard Response</label>
                <textarea value={faq.answer} onChange={(e) => updateFaq(faq.id, 'answer', e.target.value)}
                  placeholder="Write the answer exactly as you'd want a guest to receive it..."
                  className="w-full border border-slate-300 rounded-lg text-sm py-2.5 px-3 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 outline-none resize-none min-h-[80px] bg-white placeholder:text-slate-300" rows={3} />
              </div>
            </div>
          ))}
          <button onClick={addFaq} className="w-full py-3 border-2 border-dashed border-slate-200 rounded-lg text-sm text-slate-500 hover:text-indigo-600 hover:border-indigo-300 transition-colors flex items-center justify-center gap-2">
            <Plus size={16} /> Add Another FAQ
          </button>
        </div>
      );
    }

    if (section.perRoom && roomLabels.length > 0) {
      const handleCopyRoomData = (sourceRoom: number) => {
        if (!propertyId) return;
        const bulk: Record<string, string> = {};
        let count = 0;
        for (const field of section.fields) {
          if (field.id === 'smartLockId') continue; // Never copy device IDs
          const sourceKey = `${section.id}__room${sourceRoom}__${field.id}`;
          const targetKey = `${section.id}__room${activeRoomTab}__${field.id}`;
          const val = formData[sourceKey]?.trim();
          if (val) {
            bulk[targetKey] = val;
            count++;
          }
        }
        if (count > 0) {
          setOnboardingBulk(propertyId, bulk);
          toast.success(`Copied ${count} fields from ${roomLabels[sourceRoom]}`, {
            description: `Data pasted into ${roomLabels[activeRoomTab]}. Review and adjust room-specific values.`,
          });
        }
      };

      return (
        <div className="space-y-4">
          {roomLabels.length > 1 && (
            <div className="flex items-center gap-2">
              <div className="flex gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto flex-1">
                {roomLabels.map((label, idx) => {
                  const hasData = section.fields.some(f => formData[`${section.id}__room${idx}__${f.id}`]?.trim());
                  return (
                    <button key={idx} onClick={() => setActiveRoomTab(idx)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                        activeRoomTab === idx ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                      }`}>
                      {hasData && <Check size={10} className="text-green-500" />}
                      {label}
                    </button>
                  );
                })}
              </div>
              {/* Copy Room Data dropdown */}
              {roomLabels.length > 1 && (
                <div className="relative group">
                  <button className="px-2.5 py-1.5 text-[10px] font-medium text-slate-500 hover:text-indigo-600 bg-slate-100 hover:bg-indigo-50 rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap border border-transparent hover:border-indigo-200">
                    <CopyPlus size={12} /> Copy From
                  </button>
                  <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-20 min-w-[160px] opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity">
                    <p className="px-3 py-1.5 text-[9px] text-slate-400 uppercase font-bold">Copy data from:</p>
                    {roomLabels.map((label, idx) => idx !== activeRoomTab && (
                      <button key={idx} onClick={() => handleCopyRoomData(idx)}
                        className="w-full text-left px-3 py-1.5 text-xs text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 transition-colors">
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="space-y-4">
            {renderFieldGroup(section.fields, `${section.id}__room${activeRoomTab}`)}
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {renderFieldGroup(section.fields, section.id)}
      </div>
    );
  };

  const renderFieldGroup = (fields: OnboardingField[], keyPrefix: string) => {
    const elements: React.ReactNode[] = [];
    let i = 0;
    while (i < fields.length) {
      // Render group sub-header if field has a group label
      if (fields[i].group) {
        elements.push(
          <div key={`group-${fields[i].group}`} className="pt-4 pb-1 first:pt-0">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100 pb-2">{fields[i].group}</h4>
          </div>
        );
      }
      if (fields[i].half && i + 1 < fields.length && fields[i + 1].half) {
        elements.push(
          <div key={`pair-${fields[i].id}`} className="flex gap-4">
            {renderField(fields[i], keyPrefix)}
            {renderField(fields[i + 1], keyPrefix)}
          </div>
        );
        i += 2;
      } else {
        elements.push(renderField(fields[i], keyPrefix));
        i++;
      }
    }
    return elements;
  };

  const getSectionCompletionPct = (sectionId: string) => {
    const c = sectionCompletion[sectionId];
    if (!c || c.total === 0) return 0;
    return Math.round((c.filled / c.total) * 100);
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-50 h-full overflow-hidden animate-in fade-in duration-200">
      {/* Top Bar */}
      <div className="bg-white border-b border-slate-200 px-6 py-3 shrink-0 shadow-sm z-10">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mb-1.5">
          <button onClick={() => navigate('/kb')} className="hover:text-indigo-600 transition-colors">Properties</button>
          <ChevronRight size={8} />
          <span className="text-slate-600 font-medium">{prop.name}</span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/kb')} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors text-slate-400 hover:text-slate-700">
              <ArrowLeft size={18} />
            </button>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm shadow-inner ${isOnboarding ? 'bg-gradient-to-br from-amber-400 to-amber-600' : 'bg-gradient-to-br from-indigo-500 to-indigo-600'}`}>
              {prop.name.charAt(0)}
            </div>
            <div>
              <h1 className="font-bold text-slate-800 flex items-center gap-2">
                {prop.name}
                {isOnboarding ? (
                  <span className="bg-amber-100 text-amber-700 text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide">Setup</span>
                ) : (
                  <span className="bg-green-100 text-green-700 text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide">Active</span>
                )}
              </h1>
              <div className="flex items-center gap-2 text-[10px] text-slate-500">
                <span>{host.name}</span>
                <span>&bull;</span>
                <span>{prop.location}</span>
                <span>&bull;</span>
                <span>{prop.units} {prop.units === 1 ? 'unit' : 'units'}</span>
                {prop.lastSyncedAt && (
                  <>
                    <span>&bull;</span>
                    <span className={`flex items-center gap-1 ${isStaleSince(prop.lastSyncedAt) ? 'text-red-500 font-bold' : 'text-slate-400'}`}>
                      <Clock size={10} />
                      Updated {relativeTime(prop.lastSyncedAt)}
                      {isStaleSince(prop.lastSyncedAt) && ' — review recommended'}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 ml-auto">
            {/* Status & Progress */}
            <div className="flex items-center gap-2 pr-3 border-r border-slate-200">
              {/* Persist status badge + manual sync button */}
              <div className="flex items-center gap-1">
                <div className={`px-2 py-1 rounded-full text-[10px] font-medium flex items-center gap-1 ${
                  formPersistStatus === 'server'
                    ? 'bg-green-100 text-green-700'
                    : formPersistStatus === 'syncing'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-slate-100 text-slate-600'
                }`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${
                    formPersistStatus === 'server' ? 'bg-green-600'
                    : formPersistStatus === 'syncing' ? 'animate-pulse bg-amber-600'
                    : 'bg-slate-500'
                  }`} />
                  <span className="hidden sm:inline">{formPersistStatus === 'server' ? 'Server' : formPersistStatus === 'syncing' ? 'Syncing' : 'Local'}</span>
                </div>

                {/* Manual sync button - only show when local or after failed sync */}
                {formPersistStatus !== 'server' && formPersistStatus !== 'syncing' && (
                  <button
                    onClick={manualSyncFormData}
                    disabled={formPersistStatus === 'syncing'}
                    title="Manually sync to Supabase"
                    className="px-2 py-1 rounded text-[10px] font-medium flex items-center gap-1 bg-slate-200 text-slate-600 hover:bg-slate-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    ↑ Sync
                  </button>
                )}
              </div>

              {/* AI Sync status */}
              {!isOnboarding && (
                <span className={`text-[10px] font-medium flex items-center gap-1 px-2 py-1 rounded-full ${
                  saveIndicator === 'synced'
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'bg-green-100 text-green-700'
                }`}>
                  {saveIndicator === 'synced' ? (
                    <>
                      <Sparkles size={9} className="animate-spin" />
                      <span className="hidden sm:inline">Syncing</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={9} />
                      <span className="hidden sm:inline">{autoSyncedEntryCount} AI</span>
                    </>
                  )}
                </span>
              )}

              {/* Overall progress */}
              <div className="flex items-center gap-1.5">
                <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-indigo-500 to-indigo-600 rounded-full transition-all duration-500" style={{ width: `${overallProgress}%` }} />
                </div>
                <span className="text-[10px] font-bold text-slate-500 w-6 text-right">{overallProgress}%</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.pdf,.csv,.txt,.json,.docx"
                style={{ display: 'none' }}
                onChange={handleFileImport}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 text-xs rounded-lg flex items-center gap-1.5 text-indigo-600 hover:bg-indigo-50 border border-indigo-200 transition-colors font-medium"
                disabled={docProcessing}
              >
                📊 Import
              </button>
              <button
                onClick={() => setShowPortalLink(true)}
                className="px-3 py-1.5 text-xs rounded-lg flex items-center gap-1.5 text-slate-700 hover:bg-slate-100 border border-slate-200 transition-colors font-medium"
              >
                <Share2 size={12} /> Share
              </button>
              {isOnboarding && (
                <button
                  onClick={openGoLiveConfirm}
                  disabled={!isPhase1Complete}
                  className={`px-4 py-1.5 text-xs rounded-lg flex items-center gap-1.5 font-semibold transition-all ${
                    isPhase1Complete ? 'bg-green-600 text-white hover:bg-green-700 shadow-sm hover:shadow-md' : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  <Rocket size={12} /> Go Live
                </button>
              )}
              {propertyId === 'p2' && (
                <button
                  onClick={applyDataCorrections}
                  className="px-3 py-1.5 text-xs rounded-lg flex items-center gap-1.5 text-red-600 hover:bg-red-50 border border-red-200 transition-colors font-medium"
                  title="Fix incorrect/missing data"
                >
                  🔧 Fix
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Processing overlay */}
      {docProcessing && (
        <div className="absolute inset-0 bg-white/80 z-40 flex items-center justify-center">
          <div className="bg-white border border-slate-200 rounded-xl shadow-lg p-8 text-center animate-in zoom-in-95 duration-200">
            <Loader2 size={32} className="mx-auto text-indigo-500 animate-spin mb-4" />
            <h3 className="font-bold text-slate-800 mb-1">Processing Document</h3>
            <p className="text-sm text-slate-500">AI is reading the document and extracting property information...</p>
          </div>
        </div>
      )}

      {/* First-time pipeline guide */}
      {showPipelineGuide && (
        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-indigo-200 px-6 py-3 flex items-center gap-4 shrink-0 animate-in slide-in-from-top-4 duration-300">
          <div className="flex items-center gap-3 flex-1">
            <Sparkles size={18} className="text-indigo-500 shrink-0" />
            <div className="flex items-center gap-2 text-xs">
              <span className="font-bold text-indigo-700">How it works:</span>
              <span className="bg-white border border-indigo-200 text-indigo-700 px-2.5 py-1 rounded-lg font-medium">Fill out this form</span>
              <ChevronRight size={12} className="text-indigo-300" />
              {isOnboarding ? (
                <span className="bg-white border border-green-200 text-green-700 px-2.5 py-1 rounded-lg font-medium flex items-center gap-1"><Rocket size={10} /> Go Live</span>
              ) : (
                <span className="bg-white border border-green-200 text-green-700 px-2.5 py-1 rounded-lg font-medium flex items-center gap-1"><Sparkles size={10} /> Auto-syncs instantly</span>
              )}
              <ChevronRight size={12} className="text-indigo-300" />
              <span className="bg-white border border-purple-200 text-purple-700 px-2.5 py-1 rounded-lg font-medium">AI answers guest questions</span>
            </div>
          </div>
          <button
            onClick={() => setShowPipelineGuide(false)}
            className="text-indigo-400 hover:text-indigo-600 transition-colors shrink-0 p-1"
            title="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar — Section Navigation */}
        <div className="w-72 bg-white border-r border-slate-200 flex flex-col shrink-0 overflow-y-auto">
          {/* Sidebar search */}
          <div className="p-3 border-b border-slate-100">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={sidebarSearch}
                onChange={(e) => setSidebarSearch(e.target.value)}
                placeholder="Find section (e.g. wifi, rules)..."
                className="w-full pl-8 pr-7 py-2 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-400 outline-none"
              />
              {sidebarSearch && (
                <button onClick={() => setSidebarSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Stale data warning */}
          {prop.lastSyncedAt && isStaleSince(prop.lastSyncedAt) && (
            <div className="m-3 mb-0 bg-red-50 border border-red-200 rounded-lg p-3">
              <div className="flex items-center gap-2 text-red-700 mb-1">
                <AlertTriangle size={14} />
                <span className="text-[10px] font-bold uppercase">Review Needed</span>
              </div>
              <p className="text-[10px] text-red-600">
                Last updated {relativeTime(prop.lastSyncedAt)}. Check with the host for any changes.
              </p>
            </div>
          )}

          {/* Phase sections */}
          {(() => {
            const searchLower = sidebarSearch.toLowerCase();
            const filteredByPhase: Record<number, typeof formTemplate> = {};
            for (const phase of formPhases) {
              filteredByPhase[phase.id] = (sectionsByPhase[phase.id] || []).filter(s => !searchLower || s.title.toLowerCase().includes(searchLower) || s.fields.some(f => f.label.toLowerCase().includes(searchLower)));
            }
            const filteredCustom = propCustomSections.filter(cs => !searchLower || cs.title.toLowerCase().includes(searchLower));
            const anyPhaseVisible = formPhases.some(p => (filteredByPhase[p.id] || []).length > 0);
            const showCustom = filteredCustom.length > 0 || !searchLower;

            return (
              <>
                {formPhases.map((phase, phaseIdx) => {
                  const filtered = filteredByPhase[phase.id] || [];
                  if (filtered.length === 0) return null;
                  const phasePct = phaseProgress[phase.id] || 0;
                  const isFirst = phaseIdx === 0;
                  return (
                    <div key={phase.id} className="p-4 border-b border-slate-100">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {isOnboarding ? (
                            <>
                              {isFirst
                                ? <ShieldCheck size={14} className="text-red-500" />
                                : <Sparkles size={14} className="text-amber-500" />}
                              <span className="text-[10px] font-bold text-slate-800 uppercase tracking-wider">Phase {phase.id} — {phase.label}</span>
                            </>
                          ) : (
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{phase.label}</span>
                          )}
                        </div>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          phasePct === 100 ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                        }`}>{phasePct}%</span>
                      </div>
                      {isOnboarding && isFirst && <p className="text-[10px] text-slate-400 mb-2">Must complete before going live</p>}
                      {isOnboarding && !isFirst && <p className="text-[10px] text-slate-400 mb-2">Complete within 2 weeks of going live</p>}
                      <div className="space-y-0.5">
                        {filtered.map(section => {
                          const pct = getSectionCompletionPct(section.id);
                          const isActive = activeSection === section.id;
                          return (
                            <button key={section.id} onClick={() => { setActiveSection(section.id); setActiveRoomTab(0); setSidebarSearch(''); }}
                              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all ${
                                isActive ? 'bg-indigo-50 text-indigo-700 shadow-sm' : 'text-slate-600 hover:bg-slate-50'
                              }`}>
                              <div className={`shrink-0 ${isActive ? 'text-indigo-500' : 'text-slate-400'}`}>
                                {pct === 100 ? <CheckCircle2 size={16} className="text-green-500" /> : SECTION_ICONS[section.id]}
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className="text-xs font-medium block truncate flex items-center gap-1">
                                  {section.title}
                                  {section.hostHidden && <EyeOff size={9} className="text-amber-500 shrink-0" />}
                                </span>
                                {pct > 0 && pct < 100 && (
                                  <div className="w-full h-1 bg-slate-200 rounded-full mt-1">
                                    <div className="h-full bg-indigo-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                                  </div>
                                )}
                              </div>
                              {pct > 0 && pct < 100 && <span className="text-[9px] font-bold text-slate-400 shrink-0">{pct}%</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {/* Additional AI Knowledge (Custom Sections) — above Phase 2 for discoverability */}
                {showCustom && (
                  <div className="p-4 border-b border-slate-100">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <StickyNote size={14} className="text-indigo-500" />
                        <span className="text-[10px] font-bold text-slate-800 uppercase tracking-wider">Freeform Notes</span>
                      </div>
                      <span className="text-[10px] text-slate-400">{propCustomSections.length}</span>
                    </div>
                    <p className="text-[10px] text-slate-400 mb-2">Extra info for the AI that doesn't fit the standard fields</p>
                    <div className="space-y-0.5 mb-3">
                      {filteredCustom.map(cs => {
                        const isActive = activeSection === `_custom__${cs.id}`;
                        const hasContent = !!formData[`_custom__${cs.id}__content`]?.trim();
                        return (
                          <button key={cs.id} onClick={() => { setActiveSection(`_custom__${cs.id}`); setActiveRoomTab(0); setSidebarSearch(''); }}
                            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all ${
                              isActive ? 'bg-indigo-50 text-indigo-700 shadow-sm' : 'text-slate-600 hover:bg-slate-50'
                            }`}>
                            <div className={`shrink-0 ${isActive ? 'text-indigo-500' : 'text-slate-400'}`}>
                              {hasContent ? <CheckCircle2 size={16} className="text-green-500" /> : <StickyNote size={16} />}
                            </div>
                            <span className="text-xs font-medium truncate flex-1">{cs.title}</span>
                          </button>
                        );
                      })}
                    </div>

                    {!sidebarSearch && (showAddCustomSection ? (
                      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 space-y-2">
                        <input
                          type="text"
                          value={newCustomSectionTitle}
                          onChange={(e) => setNewCustomSectionTitle(e.target.value)}
                          placeholder="Section name (e.g. Vendor Protocols)"
                          className="w-full border border-indigo-200 rounded text-xs py-1.5 px-2.5 focus:ring-1 focus:ring-indigo-500 outline-none bg-white"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && newCustomSectionTitle.trim()) {
                              const newId = addCustomFormSection(propertyId!, newCustomSectionTitle.trim());
                              setActiveSection(`_custom__${newId}`);
                              setNewCustomSectionTitle('');
                              setShowAddCustomSection(false);
                              toast.success(`Added section "${newCustomSectionTitle.trim()}"`);
                            }
                          }}
                        />
                        <div className="flex justify-end gap-2">
                          <button onClick={() => { setShowAddCustomSection(false); setNewCustomSectionTitle(''); }} className="px-2 py-1 text-[10px] text-slate-500 hover:bg-white rounded">Cancel</button>
                          <button
                            onClick={() => {
                              if (!newCustomSectionTitle.trim()) return;
                              const newId = addCustomFormSection(propertyId!, newCustomSectionTitle.trim());
                              setActiveSection(`_custom__${newId}`);
                              setNewCustomSectionTitle('');
                              setShowAddCustomSection(false);
                              toast.success(`Added section "${newCustomSectionTitle.trim()}"`);
                            }}
                            className="px-2 py-1 text-[10px] bg-indigo-600 text-white rounded hover:bg-indigo-700 flex items-center gap-1"
                          >
                            <Check size={10} /> Add
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowAddCustomSection(true)}
                        className="w-full py-2 border-2 border-dashed border-slate-200 rounded-lg text-[10px] text-slate-400 hover:text-indigo-600 hover:border-indigo-200 transition-colors flex items-center justify-center gap-1.5"
                      >
                        <Plus size={12} /> Add Freeform Note
                      </button>
                    ))}
                  </div>
                )}

                {/* No search results */}
                {sidebarSearch && !anyPhaseVisible && !showCustom && (
                  <div className="p-6 text-center">
                    <p className="text-xs text-slate-400">No sections match "{sidebarSearch}"</p>
                    <button onClick={() => setSidebarSearch('')} className="text-[10px] text-indigo-500 hover:text-indigo-700 mt-1">Clear search</button>
                  </div>
                )}
              </>
            );
          })()}

          {/* Form Builder cross-link */}
          <div className="mt-auto p-3 border-t border-slate-100">
            <button
              onClick={() => navigate('/settings/form-builder')}
              className="w-full flex items-center gap-2 px-3 py-2 text-[10px] text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
            >
              <Settings2 size={12} />
              <span>Customize form fields</span>
              <ChevronRight size={10} className="ml-auto" />
            </button>
          </div>
        </div>

        {/* Main Content — Form */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto py-8 px-6">
            {/* Metadata Header — collapsible for active properties */}
            {(isOnboarding || showMetadata) ? (
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm mb-6">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Form Metadata</span>
                  {!isOnboarding && (
                    <button onClick={() => setShowMetadata(false)} className="text-[10px] text-slate-400 hover:text-slate-600 flex items-center gap-1">
                      <ChevronDown size={10} className="rotate-180" /> Collapse
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-6 flex-wrap">
                  <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                    <User size={14} className="text-slate-400 shrink-0" />
                    <div className="flex-1">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Filled By</label>
                      <input
                        type="text"
                        value={formData['_meta__filledBy'] || ''}
                        onChange={(e) => setField('_meta__filledBy', e.target.value)}
                        placeholder="e.g. Tanaka-san (host), Sarah (CS team)"
                        className="w-full text-sm text-slate-700 bg-transparent border-0 border-b border-slate-200 focus:border-indigo-400 outline-none py-1 px-0 placeholder:text-slate-300"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 min-w-[180px]">
                    <CalendarDays size={14} className="text-slate-400 shrink-0" />
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Date Filled</label>
                      <input
                        type="date"
                        value={formData['_meta__dateFilled'] || ''}
                        onChange={(e) => setField('_meta__dateFilled', e.target.value)}
                        className="text-sm text-slate-700 bg-transparent border-0 border-b border-slate-200 focus:border-indigo-400 outline-none py-1 px-0"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 min-w-[180px]">
                    <CalendarDays size={14} className="text-slate-400 shrink-0" />
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Last Reviewed</label>
                      <input
                        type="date"
                        value={formData['_meta__lastReviewed'] || ''}
                        onChange={(e) => setField('_meta__lastReviewed', e.target.value)}
                        className="text-sm text-slate-700 bg-transparent border-0 border-b border-slate-200 focus:border-indigo-400 outline-none py-1 px-0"
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowMetadata(true)}
                className="mb-6 w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 shadow-sm flex items-center justify-between hover:bg-slate-50 transition-colors"
              >
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Form Metadata</span>
                <span className="text-[10px] text-slate-400 flex items-center gap-1">
                  {formData['_meta__filledBy'] && <span className="text-slate-500">by {formData['_meta__filledBy']}</span>}
                  <ChevronDown size={10} />
                </span>
              </button>
            )}

            {/* Custom Section Content */}
            {activeSection.startsWith('_custom__') ? (() => {
              const customSectionId = activeSection.replace('_custom__', '');
              const customSection = propCustomSections.find(cs => cs.id === customSectionId);
              if (!customSection) return null;
              const contentKey = `_custom__${customSectionId}__content`;
              return (
                <>
                  <div className="mb-6">
                    <div className="flex items-center gap-2 text-[10px] text-slate-400 mb-2">
                      <span className="px-1.5 py-0.5 rounded font-bold uppercase bg-indigo-50 text-indigo-600">Custom</span>
                    </div>
                    <div className="flex items-center gap-3 mb-2">
                      <div className="p-2 bg-indigo-100 rounded-lg text-indigo-600">
                        <StickyNote size={16} />
                      </div>
                      {editingCustomSectionId === customSectionId ? (
                        <div className="flex items-center gap-2 flex-1">
                          <input
                            type="text"
                            value={editingCustomSectionTitle}
                            onChange={(e) => setEditingCustomSectionTitle(e.target.value)}
                            className="text-xl font-bold text-slate-800 border-b-2 border-indigo-400 outline-none bg-transparent flex-1 py-0.5"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && editingCustomSectionTitle.trim()) {
                                renameCustomFormSection(propertyId!, customSectionId, editingCustomSectionTitle.trim());
                                setEditingCustomSectionId(null);
                              }
                            }}
                          />
                          <button onClick={() => { renameCustomFormSection(propertyId!, customSectionId, editingCustomSectionTitle.trim()); setEditingCustomSectionId(null); }}
                            className="p-1.5 text-green-600 hover:bg-green-50 rounded"><Check size={14} /></button>
                          <button onClick={() => setEditingCustomSectionId(null)}
                            className="p-1.5 text-slate-400 hover:bg-slate-50 rounded"><X size={14} /></button>
                        </div>
                      ) : (
                        <>
                          <h2 className="text-xl font-bold text-slate-800">{customSection.title}</h2>
                          <button onClick={() => { setEditingCustomSectionId(customSectionId); setEditingCustomSectionTitle(customSection.title); }}
                            className="p-1.5 text-slate-300 hover:text-indigo-500 rounded transition-colors"><Pencil size={14} /></button>
                        </>
                      )}
                    </div>
                    <p className="text-sm text-slate-500 ml-[44px]">Write anything the AI should know about this property. {isActive ? 'Changes auto-sync to the AI.' : 'This will be included when the property goes live.'}</p>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-4">
                    <textarea
                      value={formData[contentKey] || ''}
                      onChange={(e) => setField(contentKey, e.target.value)}
                      placeholder="Write notes, special instructions, vendor details, seasonal info, behavioral rules, or anything else that the AI should know about this property..."
                      className="w-full border border-slate-300 rounded-lg text-sm py-3 px-4 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 outline-none transition-colors bg-white placeholder:text-slate-300 resize-none min-h-[200px]"
                      rows={8}
                    />
                  </div>

                  <button
                    onClick={() => {
                      if (confirm(`Remove "${customSection.title}"? The content will be lost.`)) {
                        removeCustomFormSection(propertyId!, customSectionId);
                        setActiveSection(ONBOARDING_SECTIONS[0].id);
                        toast.success('Custom section removed');
                      }
                    }}
                    className="text-xs text-red-400 hover:text-red-600 flex items-center gap-1.5 transition-colors mb-6"
                  >
                    <Trash2 size={12} /> Remove this section
                  </button>
                </>
              );
            })() : (
            <>
            {/* Section Header */}
            <div className="mb-6">
              <div className="flex items-center gap-2 text-[10px] text-slate-400 mb-2">
                {(() => {
                  const ph = formPhases.find(p => p.id === currentSection.phase);
                  const label = ph?.label || `Phase ${currentSection.phase}`;
                  return isOnboarding ? (
                    <>
                      <span className="px-1.5 py-0.5 rounded font-bold uppercase bg-slate-100 text-slate-600">
                        Phase {currentSection.phase} — {label}
                      </span>
                      <span>&bull;</span>
                      <span>Section {currentIndex + 1} of {ONBOARDING_SECTIONS.length}</span>
                    </>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded font-bold uppercase bg-slate-100 text-slate-500">
                      {label}
                    </span>
                  );
                })()}
              </div>
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-indigo-100 rounded-lg text-indigo-600">
                  {SECTION_ICONS[currentSection.id] || <Circle size={16} />}
                </div>
                <h2 className="text-xl font-bold text-slate-800">{currentSection.title}</h2>
                {currentSection.hostHidden && (
                  <span className="text-[10px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 flex items-center gap-1 shrink-0">
                    <EyeOff size={10} /> Agent-Only
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-500 ml-[44px]">{currentSection.description}</p>
            </div>

            {/* Form Content */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-4">
              {renderSectionContent(currentSection)}
            </div>

            {/* Section Notes — always visible collapsed row */}
            {currentSection.id !== 'faqs' && (() => {
              const notesKey = currentSection.perRoom
                ? `${currentSection.id}__room${activeRoomTab}__notes`
                : `${currentSection.id}__notes`;
              const notesValue = formData[notesKey] || '';
              const hasContent = notesValue.trim().length > 0;
              const isExpanded = hasContent || notesKey in formData;
              return (
                <div className="mb-6">
                  <div className={`rounded-xl border transition-colors ${isExpanded ? 'bg-amber-50/50 border-amber-200/60 p-4' : 'bg-slate-50 border-slate-200 hover:border-amber-300'}`}>
                    {isExpanded ? (
                      <>
                        <label className="flex items-center gap-1.5 text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-2">
                          <StickyNote size={10} /> Additional Notes
                          <span className="text-amber-400 font-normal normal-case tracking-normal ml-1">— Extra info for the AI</span>
                        </label>
                        <textarea
                          value={notesValue}
                          onChange={(e) => setField(notesKey, e.target.value)}
                          placeholder="e.g. The hot water in this unit takes 2 minutes to heat up. The AC remote is in the top drawer of the nightstand..."
                          className="w-full border border-amber-200 rounded-lg text-sm py-2.5 px-3 focus:ring-2 focus:ring-amber-400/20 focus:border-amber-400 outline-none transition-colors bg-white placeholder:text-amber-300/60 resize-none min-h-[80px]"
                          rows={3}
                        />
                      </>
                    ) : (
                      <button
                        onClick={() => setField(notesKey, '')}
                        className="w-full p-3 flex items-center gap-2 text-xs text-slate-500 cursor-pointer"
                      >
                        <StickyNote size={14} className="text-amber-400" />
                        <span>Additional Notes</span>
                        <span className="text-[10px] text-slate-400">— click to add extra info for the AI</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}
            </>
            )}

            {/* Navigation — only show for first-time onboarding */}
            {!isCustomSection && isOnboarding && (
            <div className="flex items-center justify-between">
              <button onClick={goPrev} disabled={currentIndex === 0}
                className={`px-4 py-2 text-sm rounded-lg flex items-center gap-2 transition-colors ${
                  currentIndex === 0 ? 'text-slate-300 cursor-not-allowed' : 'text-slate-600 hover:bg-white hover:shadow-sm border border-transparent hover:border-slate-200'
                }`}>
                <ArrowLeft size={14} /> Previous
              </button>
              <div className="flex items-center gap-1">
                {ONBOARDING_SECTIONS.map((s, i) => (
                  <button key={s.id} onClick={() => { setActiveSection(s.id); setActiveRoomTab(0); }}
                    className={`w-2 h-2 rounded-full transition-all ${
                      i === currentIndex ? 'bg-indigo-500 w-4'
                      : getSectionCompletionPct(s.id) === 100 ? 'bg-green-400'
                      : getSectionCompletionPct(s.id) > 0 ? 'bg-amber-300' : 'bg-slate-200'
                    }`} />
                ))}
              </div>
              {currentIndex < ONBOARDING_SECTIONS.length - 1 ? (
                <button onClick={goNext} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-2 font-medium shadow-sm transition-colors">
                  Next <ChevronRight size={14} />
                </button>
              ) : (
                <button onClick={openGoLiveConfirm} disabled={!isPhase1Complete}
                  className={`px-4 py-2 text-sm rounded-lg flex items-center gap-2 font-medium transition-colors ${
                    isPhase1Complete ? 'bg-green-600 text-white hover:bg-green-700 shadow-sm' : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  }`}>
                  <Rocket size={14} /> Go Live
                </button>
              )}
            </div>
            )}

            {!isPhase1Complete && !isCustomSection && isOnboarding && (
              <div className="mt-6 bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
                <AlertTriangle size={18} className="text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-bold text-amber-800">Required Fields Incomplete</p>
                  <p className="text-xs text-amber-600 mt-1">
                    Complete all required fields (marked with <span className="text-red-400 font-bold">*</span>) in the Core Info sections before going live. Guest Experience sections can be completed afterwards.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Import Preview Modal ── */}
      {importPreview && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[80vh] animate-in zoom-in-95 duration-200">
            <div className="p-4 border-b border-slate-200">
              <h2 className="font-bold text-slate-800">Import Preview</h2>
              <p className="text-xs text-slate-500 mt-0.5">{Object.keys(importPreview.data).length + (importPreview.faqs?.length || 0)} fields extracted from "{importPreview.fileName}". Review before applying.</p>
            </div>
            <div className="overflow-y-auto flex-1 p-3 space-y-2">
              {Object.entries(importPreview.data).map(([key, value]) => {
                const label = importPreview.schema[key]?.label || key;
                const current = formData[key];
                if (current && String(current) === String(value)) return null;
                return (
                  <div key={key} className="p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs">
                    <p className="font-semibold text-slate-600">{label}</p>
                    <p className="text-indigo-700 font-medium mt-1">→ {value}</p>
                    {current ? (
                      <p className="text-slate-400 mt-0.5 truncate">Current: {current}</p>
                    ) : (
                      <p className="text-emerald-500 mt-0.5">Empty — will be filled</p>
                    )}
                  </div>
                );
              })}
              {importPreview.faqs && importPreview.faqs.length > 0 && (
                <div className="p-3 rounded-lg border border-indigo-200 bg-indigo-50 text-xs">
                  <p className="font-semibold text-indigo-700 mb-2">FAQs ({importPreview.faqs.length})</p>
                  {importPreview.faqs.map((faq, i) => (
                    <div key={i} className="mb-2 last:mb-0">
                      <p className="text-indigo-700 font-medium">Q: {faq.question}</p>
                      <p className="text-slate-600 mt-0.5">A: {faq.answer}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-slate-200 flex gap-2 justify-end">
              <button onClick={() => setImportPreview(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
              <button onClick={confirmImport} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium">Apply Import</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Go Live Confirmation Modal (first-time onboarding only) ── */}
      {showGoLiveConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 animate-in zoom-in-95 duration-200 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-green-100 rounded-lg text-green-600"><Rocket size={20} /></div>
              <div>
                <h3 className="font-bold text-slate-800">Go Live?</h3>
                <p className="text-xs text-slate-500">This will make the property active and give the AI all your property info so it can answer guest questions.</p>
              </div>
            </div>
            <div className="bg-slate-50 rounded-lg p-4 mb-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Property</span>
                <span className="font-bold text-slate-800">{prop.name}</span>
              </div>
              {formPhases.map((phase, idx) => {
                const pct = phaseProgress[phase.id] || 0;
                return (
                  <div key={phase.id} className="flex justify-between text-sm">
                    <span className="text-slate-600">Phase {phase.id} ({phase.label})</span>
                    <span className={`font-bold ${pct === 100 ? 'text-green-600' : idx === 0 ? 'text-amber-600' : 'text-slate-500'}`}>{pct}%</span>
                  </div>
                );
              })}
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Status After</span>
                <span className="font-bold text-green-600 flex items-center gap-1"><CheckCircle2 size={12} /> Active</span>
              </div>
            </div>

            {formPhases.slice(1).some(p => (phaseProgress[p.id] || 0) < 100) && (
              <p className="text-[10px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg p-2 mb-4">
                {formPhases.slice(1).filter(p => (phaseProgress[p.id] || 0) < 100).map(p => p.label).join(', ')} sections are not yet 100% complete. You can go live now and fill in the rest later — we recommend completing them within 2 weeks.
              </p>
            )}

            <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 mb-4">
              <p className="text-[10px] text-indigo-700 flex items-start gap-1.5">
                <Sparkles size={12} className="shrink-0 mt-0.5" />
                <span>After going live, all future edits to this form will <strong>automatically update the AI's knowledge</strong> — no publish step needed.</span>
              </p>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setShowGoLiveConfirm(false)} className="flex-1 px-4 py-2.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleGoLive} className="flex-1 px-4 py-2.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium flex items-center justify-center gap-2 shadow-sm transition-colors">
                <Rocket size={14} /> Go Live
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Document Upload Modal ── */}

      {/* ── Host Portal Link Modal ── */}
      {showPortalLink && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-100 rounded-lg text-indigo-600"><Link2 size={20} /></div>
                <div>
                  <h3 className="font-bold text-slate-800">Host Review Portal</h3>
                  <p className="text-xs text-slate-500">Share this link with the property owner to review & update their info.</p>
                </div>
              </div>
              <button onClick={() => setShowPortalLink(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            <div className="mb-4 space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Host Shareable Link</label>
                <div className="flex gap-2">
                  <div className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-xs text-slate-600 truncate font-mono">
                    {portalUrl || 'Go live first to generate a portal link'}
                  </div>
                  <button
                    onClick={() => copyPortalLink(portalUrl, false)}
                    disabled={!portalUrl}
                    className="px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 transition-colors flex items-center gap-1.5 text-xs font-medium shrink-0"
                  >
                    <Copy size={12} /> Copy
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Internal Access Link</label>
                <div className="flex gap-2">
                  <div className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-xs text-slate-600 truncate font-mono">
                    {internalPortalUrl || 'Go live first to generate an internal link'}
                  </div>
                  <button
                    onClick={() => copyPortalLink(internalPortalUrl, true)}
                    disabled={!internalPortalUrl}
                    className="px-3 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:bg-slate-200 disabled:text-slate-400 transition-colors flex items-center gap-1.5 text-xs font-medium shrink-0"
                  >
                    <Copy size={12} /> Copy
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-4 space-y-3">
              <h4 className="text-xs font-bold text-indigo-800">How the Host Portal Works</h4>
              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <span className="text-[10px] font-bold text-indigo-600 bg-indigo-200 rounded-full w-4 h-4 flex items-center justify-center shrink-0 mt-0.5">1</span>
                  <p className="text-[10px] text-indigo-700">Host opens the link — no login required.</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[10px] font-bold text-indigo-600 bg-indigo-200 rounded-full w-4 h-4 flex items-center justify-center shrink-0 mt-0.5">2</span>
                  <p className="text-[10px] text-indigo-700">They see their property info in familiar form fields and can make edits.</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[10px] font-bold text-indigo-600 bg-indigo-200 rounded-full w-4 h-4 flex items-center justify-center shrink-0 mt-0.5">3</span>
                  <p className="text-[10px] text-indigo-700">They click "Submit Changes" — your team gets notified to review and sync.</p>
                </div>
              </div>
            </div>

            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-[10px] text-amber-700 flex items-start gap-1.5">
                <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                The portal is view/edit only. Changes submitted by the host are queued for your review — they don't go live automatically.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}