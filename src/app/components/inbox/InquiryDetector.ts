/**
 * Inquiry Detector — Pattern-matches guest messages into discrete inquiry types.
 * Pure functions, no React dependency.
 *
 * Architecture:
 * 1. Regex fast-path — instant, deterministic, free (detectInquiries)
 * 2. LLM fallback — async, handles novel/unknown topics (classifyWithLLM)
 * 3. Fuzzy KB scoring — Levenshtein-tolerant keyword matching (scoreKBForInquiry)
 */

import type { KBEntry } from '../../data/types';

export interface DetectedInquiry {
  id: string;
  type: InquiryType | string; // string allows LLM-invented slugs
  label: string;
  detail: string;
  confidence: 'high' | 'medium' | 'low';
  /** KB tags most likely to match */
  relevantTags: string[];
  /** Extra keywords to boost KB search */
  keywords: string[];
  /** Whether this was classified by the LLM */
  aiClassified?: boolean;
  /** Whether a KB/form lookup is actually needed (false for greetings, social messages, etc.) */
  needsKbSearch?: boolean;
  /** AI-generated plain-text briefing for the agent (used in ai-context mode) */
  context?: string;
}

export type InquiryType =
  | 'maintenance'
  | 'wifi'
  | 'checkout'
  | 'checkin'
  | 'noise'
  | 'luggage'
  | 'directions'
  | 'billing'
  | 'amenities'
  | 'pet'
  | 'houserules'
  | 'safety'
  | 'greeting'
  | 'general';

interface PatternRule {
  type: InquiryType;
  label: string;
  patterns: RegExp[];
  tags: string[];
  detailExtractor?: (text: string) => string;
}

const PATTERN_RULES: PatternRule[] = [
  {
    type: 'maintenance',
    label: 'Maintenance Request',
    patterns: [
      /\b(ac|a\/c|air\s*condition|hvac|heat|broken|not working|repair|fix|leak|plumb|shower|toilet|faucet|light|bulb|warm air|blowing warm)\b/i,
    ],
    tags: ['Maintenance', 'HVAC', 'Vendors', 'Emergency'],
    detailExtractor: (t) => {
      if (/\b(ac|a\/c|air\s*condition|hvac|warm air|blowing warm|cool|cold)\b/i.test(t)) return 'AC / HVAC issue reported';
      if (/\b(leak|plumb|shower|toilet|faucet|water)\b/i.test(t)) return 'Plumbing issue reported';
      if (/\b(light|bulb|electric|power)\b/i.test(t)) return 'Electrical issue reported';
      return 'General maintenance request';
    },
  },
  {
    type: 'wifi',
    label: 'Wi-Fi / Connectivity',
    patterns: [
      /\b(wi-?fi|wifi|internet|connect|disconnect|network|router|slow|dropping|bandwidth|video call)\b/i,
    ],
    tags: ['Wi-Fi/Tech'],
    detailExtractor: (t) => {
      if (/\b(drop|disconnect|keeps?\s+drop|intermittent)\b/i.test(t)) return 'Intermittent connectivity / disconnections';
      if (/\b(slow|speed|bandwidth)\b/i.test(t)) return 'Slow connection speed';
      if (/\b(password|connect|how)\b/i.test(t)) return 'Needs connection instructions';
      return 'Wi-Fi assistance needed';
    },
  },
  {
    type: 'checkout',
    label: 'Late Checkout Request',
    patterns: [
      /\b(late\s*check\s*out|check\s*out\s*late|stay\s*longer|extend|checkout\s*at\s*\d|leave\s*late|2\s*pm|1\s*pm)\b/i,
      /\b(check\s*out).{0,30}\b(later|extend|extra|2|pm)\b/i,
    ],
    tags: ['Check-out', 'Policies'],
    detailExtractor: (t) => {
      const timeMatch = t.match(/check\s*out\s*(?:at\s*)?(\d{1,2}(?:\s*(?:pm|am))?)/i);
      if (timeMatch) return `Requesting checkout at ${timeMatch[1]}`;
      return 'Requesting later checkout time';
    },
  },
  {
    type: 'checkin',
    label: 'Early Check-in Request',
    patterns: [
      /\b(early\s*check\s*in|check\s*in\s*early|arrive\s*early|before\s*3|before\s*check\s*in)\b/i,
      /\b(entry|door|code|lock|key|access|get\s*in)\b/i,
    ],
    tags: ['Check-in', 'Security'],
    detailExtractor: (t) => {
      if (/\b(code|lock|key|access)\b/i.test(t)) return 'Needs entry code / access info';
      return 'Requesting early check-in';
    },
  },
  {
    type: 'noise',
    label: 'Noise Complaint',
    patterns: [
      /\b(noise|noisy|loud|music|party|quiet\s*hours?|cannot\s*sleep|can't\s*sleep|disturb|upstairs|neighbor)\b/i,
    ],
    tags: ['Noise', 'House Rules', 'Policies'],
    detailExtractor: (t) => {
      if (/\b(music|party)\b/i.test(t)) return 'Loud music or party reported';
      if (/\b(upstairs|neighbor|next\s*door)\b/i.test(t)) return 'Noise from neighboring unit';
      return 'Noise disturbance reported';
    },
  },
  {
    type: 'luggage',
    label: 'Luggage / Storage',
    patterns: [
      /\b(luggage|bags?|baggage|storage|drop\s*off|store|suitcase|belongings|coin\s*locker)\b/i,
    ],
    tags: ['Logistics', 'Policies', 'Check-in'],
    detailExtractor: (t) => {
      if (/\b(drop|early|before)\b/i.test(t)) return 'Wants to drop bags before check-in';
      if (/\b(after|check\s*out|store)\b/i.test(t)) return 'Needs post-checkout storage';
      return 'Luggage accommodation request';
    },
  },
  {
    type: 'directions',
    label: 'Directions / Transport',
    patterns: [
      /\b(direction|how\s*to\s*get|airport|station|taxi|grab|uber|transfer|transport|bus|train|get\s*to|get\s*from)\b/i,
    ],
    tags: ['Transportation', 'Local Info', 'Check-in'],
    detailExtractor: (t) => {
      if (/\bairport\b/i.test(t)) return 'Airport transfer inquiry';
      if (/\b(station|train|bus)\b/i.test(t)) return 'Public transit directions needed';
      return 'Transport / directions inquiry';
    },
  },
  {
    type: 'billing',
    label: 'Billing / Refund',
    patterns: [
      /\b(refund|charge|bill|invoice|overcharge|cancel|money|payment|receipt|extra\s*fee)\b/i,
    ],
    tags: ['Billing', 'Policies'],
    detailExtractor: (t) => {
      if (/\brefund\b/i.test(t)) return 'Requesting a refund';
      if (/\b(overcharge|extra|wrong)\b/i.test(t)) return 'Disputing a charge';
      return 'Billing inquiry';
    },
  },
  {
    type: 'amenities',
    label: 'Amenity Inquiry',
    patterns: [
      /\b(pool|gym|sauna|jacuzzi|hot\s*tub|kitchen|laundry|washer|dryer|iron|hair\s*dryer|towel|toiletries|breakfast|coffee|minibar|balcony|bbq|grill|elevator|parking|bicycle|bike|tv|netflix|streaming|speaker|bluetooth)\b/i,
    ],
    tags: ['Amenities', 'Local Info'],
    detailExtractor: (t) => {
      if (/\b(pool|swim)\b/i.test(t)) return 'Pool / swimming inquiry';
      if (/\b(gym|fitness|exercise)\b/i.test(t)) return 'Gym / fitness inquiry';
      if (/\b(kitchen|cook|stove|oven|microwave)\b/i.test(t)) return 'Kitchen facilities inquiry';
      if (/\b(laundry|washer|dryer|iron)\b/i.test(t)) return 'Laundry / cleaning facilities inquiry';
      if (/\b(breakfast|coffee|food)\b/i.test(t)) return 'Food / breakfast inquiry';
      if (/\b(parking|bicycle|bike)\b/i.test(t)) return 'Parking / transport inquiry';
      if (/\b(tv|netflix|streaming|speaker)\b/i.test(t)) return 'Entertainment / media inquiry';
      return 'Amenity availability inquiry';
    },
  },
  {
    type: 'safety',
    label: 'Safety / Emergency',
    patterns: [
      /\b(weapon|gun|knife|firearm|sword|machete|pepper\s*spray)s?\b/i,
      /\b(threat|assault|violen|attack|fight|intruder|break[\s-]?in|stalker|harass)(?:s|ed|ing|ment)?\b/i,
      /\b(fire|flood|gas\s*leak|carbon\s*monoxide|smoke|explosion|earthquake)s?\b/i,
      /\b(medical\s*emergenc|ambulance|police|suicide|self[\s-]?harm|overdose|unresponsive|unconscious|chest\s*pain|anaphyla)(?:y|ies|s|tic)?\b/i,
      /\b(drugs|narcotic|illegal\s*substanc)(?:s|es)?\b/i,
    ],
    tags: ['Emergency', 'Safety', 'Vendors'],
    detailExtractor: (t) => {
      if (/\b(weapon|gun|knife|firearm|sword)s?\b/i.test(t)) return 'Weapons / dangerous items mentioned';
      if (/\b(fire|flood|gas\s*leak|carbon\s*monoxide|smoke|explosion)s?\b/i.test(t)) return 'Environmental emergency reported';
      if (/\b(medical|ambulance|unresponsive|unconscious|chest\s*pain|anaphyla)/i.test(t)) return 'Medical emergency reported';
      if (/\b(threat|assault|violen|attack|intruder|break[\s-]?in|stalker|harass)/i.test(t)) return 'Security threat reported';
      if (/\b(suicide|self[\s-]?harm|overdose)/i.test(t)) return 'Mental health / self-harm concern';
      if (/\b(drugs|narcotic|illegal)/i.test(t)) return 'Illegal substances mentioned';
      return 'Safety concern flagged';
    },
  },
  {
    type: 'pet',
    label: 'Pet Policy',
    patterns: [
      /\b(pet|pets|dog|dogs|puppy|puppies|cat|cats|kitten|animal|animals|furry\s*friend|turtle|turtles|tortoise|fish|goldfish|hamster|hamsters|rabbit|rabbits|bunny|bird|birds|parrot|parrots|snake|snakes|reptile|reptiles|lizard|gerbil|guinea\s*pig|ferret|bring\s*my\s*dog|bring\s*my\s*cat|bring\s*my\s*pet|service\s*animal|emotional\s*support|esa|pet[- ]?friendly|pet[- ]?policy|pet[- ]?fee|pet[- ]?deposit|no[- ]?pets?|tiger|tigers|lion|lions|monkey|monkeys|horse|horses|pig|pigs|bear|bears|exotic\s*(?:pet|animal)|spider|tarantula|iguana|chinchilla|hedgehog|raccoon|fox|wolf|coyote)\b/i,
      // "bring a <animal>" catch-all (animal word is REQUIRED, not optional)
      /\bbring\s+(?:a|my|our|the)\s+(?:pet|animal|dog|cat|bird|fish|turtle|tiger|lion|monkey|snake|rabbit|hamster|parrot|ferret|horse|pig|bear|lizard|iguana|spider|tarantula|chinchilla|hedgehog|raccoon|fox|wolf)\b/i,
    ],
    tags: ['Pets', 'Policies', 'House Rules'],
    detailExtractor: (t) => {
      if (/\b(service\s*animal|emotional\s*support|esa)\b/i.test(t)) return 'Service / support animal inquiry';
      if (/\b(fee|deposit|charge|cost)\b/i.test(t)) return 'Pet fee / deposit inquiry';
      if (/\b(tiger|lion|monkey|bear|wolf|coyote|fox|raccoon|exotic)\b/i.test(t)) return 'Asking about bringing an exotic/unusual animal';
      if (/\b(dog|puppy|puppies)\b/i.test(t)) return 'Asking about bringing a dog';
      if (/\b(cat|kitten)\b/i.test(t)) return 'Asking about bringing a cat';
      if (/\b(turtle|tortoise)\b/i.test(t)) return 'Asking about bringing a turtle';
      if (/\b(fish|goldfish)\b/i.test(t)) return 'Asking about bringing fish';
      if (/\b(bird|parrot)\b/i.test(t)) return 'Asking about bringing a bird';
      if (/\b(snake|reptile|lizard|iguana|tarantula|spider)\b/i.test(t)) return 'Asking about bringing a reptile/exotic';
      if (/\b(hamster|rabbit|bunny|gerbil|guinea|ferret|chinchilla|hedgehog)\b/i.test(t)) return 'Asking about bringing a small animal';
      if (/\b(horse|pig)\b/i.test(t)) return 'Asking about bringing a large animal';
      return 'Asking if pets are allowed';
    },
  },
];

// ─── Enhanced stop words (hospitality-aware) ────────────
const STOP_WORDS = new Set([
  // Common auxiliaries and pronouns
  'can', 'are', 'was', 'were', 'has', 'had', 'may', 'not', 'but', 'all', 'any',
  'its', 'his', 'her', 'our', 'who', 'how', 'why', 'let', 'get', 'got', 'yes',
  'for', 'the', 'and', 'you', 'too',
  // Hospitality-aware
  'this', 'that', 'with', 'from', 'have', 'been', 'would', 'could', 'also',
  'just', 'very', 'back', 'about', 'your', 'there', 'their', 'them', 'then',
  'than', 'will', 'some', 'what', 'when', 'hello', 'translated', 'please',
  'help', 'thanks', 'thank', 'good', 'great', 'like', 'know', 'want', 'need',
  'think', 'sure', 'okay', 'much', 'really', 'well', 'here', 'still', 'does',
  'come', 'going', 'being', 'were', 'they', 'which', 'each', 'make',
  'look', 'only', 'many', 'most', 'other', 'over', 'into', 'more',
  'should', 'after', 'before', 'where', 'right', 'thing', 'doing', 'kind',
  'bring', 'take', 'give', 'said', 'tell', 'told', 'days', 'day',
  // Hospitality-generic words — appear in nearly every KB entry,
  // so they create false-positive keyword matches across topics.
  // e.g. "policy" in a pet inquiry matching "Cancellation Policy",
  // or "rules" in a noise complaint matching "Smoking Rules".
  'policy', 'polici', 'rule', 'guest', 'book', 'property', 'host',
  'check', 'allow', 'avail', 'info', 'inform', 'detail', 'provid',
  'regard', 'question', 'inquiri', 'request', 'assist', 'support',
]);

/**
 * Basic English stemmer — strips common suffixes.
 * Not a full Porter stemmer, but catches the most impactful inflections.
 */
function stem(word: string): string {
  if (word.length < 5) return word;
  return word
    .replace(/ies$/i, 'y')
    .replace(/ying$/i, 'y')
    .replace(/ing$/i, '')
    .replace(/tion$/i, 't')
    .replace(/ment$/i, '')
    .replace(/ness$/i, '')
    .replace(/able$/i, '')
    .replace(/ible$/i, '')
    .replace(/(?<=[a-z])s$/i, '')
    .replace(/ed$/i, '');
}

function extractKeywords(text: string, _type: InquiryType | string): string[] {
  const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  const stemmed = words.map(w => stem(w));
  const unique = [...new Set(stemmed)];
  return unique.filter(w => w.length > 2 && !STOP_WORDS.has(w)).slice(0, 10);
}

// ─── Levenshtein distance (for fuzzy KB matching) ───────
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Check if keyword fuzzy-matches any word in the text.
 * Tolerances: edit distance 1 for 4-6 char words, 2 for 7+ char words.
 */
function fuzzyMatchesText(keyword: string, textWords: string[]): boolean {
  const maxDist = keyword.length <= 6 ? 1 : 2;
  return textWords.some(tw => {
    if (Math.abs(tw.length - keyword.length) > maxDist) return false;
    return levenshtein(keyword, tw) <= maxDist;
  });
}

/**
 * Detect inquiries from guest messages.
 * Scans only guest messages (not system or agent), deduplicates by type.
 */
export function detectInquiries(
  guestMessages: string[],
  ticketTags: string[],
  ticketSummary: string
): DetectedInquiry[] {
  const allText = [...guestMessages, ticketSummary].join(' ');
  const found = new Map<InquiryType, DetectedInquiry>();
  let idCounter = 0;

  for (const rule of PATTERN_RULES) {
    const matched = rule.patterns.some(p => p.test(allText));
    if (!matched) continue;
    if (found.has(rule.type)) continue;

    const detail = rule.detailExtractor ? rule.detailExtractor(allText) : `${rule.label} detected`;

    // Extract keywords from ONLY the messages that triggered this pattern,
    // not from all guest text (prevents cross-inquiry keyword bleeding)
    const matchingMessages = guestMessages.filter(msg =>
      rule.patterns.some(p => p.test(msg))
    );
    const keywordSource = matchingMessages.length > 0
      ? matchingMessages.join(' ')
      : allText; // fallback to all text only if no individual message matched (e.g. pattern spanned summary)

    // Confidence: high if both pattern + ticket tag match; medium if pattern only
    const tagOverlap = rule.tags.some(t =>
      ticketTags.some(tt => tt.toLowerCase() === t.toLowerCase())
    );

    found.set(rule.type, {
      id: `inq-${idCounter++}`,
      type: rule.type,
      label: rule.label,
      detail,
      confidence: tagOverlap ? 'high' : 'medium',
      relevantTags: rule.tags,
      keywords: extractKeywords(keywordSource, rule.type),
    });
  }

  // If nothing matched, add a generic inquiry
  if (found.size === 0) {
    found.set('general', {
      id: `inq-${idCounter++}`,
      type: 'general',
      label: 'General Inquiry',
      detail: ticketSummary || 'Guest message requires review',
      confidence: 'low',
      relevantTags: ticketTags,
      keywords: extractKeywords(allText, 'general'),
    });
  }

  return Array.from(found.values());
}

/**
 * Returns true if the regex fast-path produced only a 'general' fallback.
 * Consumers use this to decide whether to call classifyWithLLM.
 */
export function needsLLMClassification(inquiries: DetectedInquiry[]): boolean {
  return inquiries.length === 1 && inquiries[0].type === 'general';
}

/**
 * Filter out greeting/pleasantry noise from inquiry lists.
 * "Hello", "Hi", "Good morning" etc. are not real inquiries — they're
 * conversational openers. Showing them as separate items in "What the
 * guest needs" is noisy and confusing for agents.
 *
 * Rules:
 * - If the ONLY inquiry is a greeting, keep it (so the panel isn't empty)
 * - If there are other real inquiries alongside a greeting, drop the greeting
 */
const GREETING_PATTERNS = /^(greeting|pleasantr|salutation|hello|hi\b|hey\b|good\s*(morning|afternoon|evening))/i;

export function filterGreetingNoise(inquiries: DetectedInquiry[]): DetectedInquiry[] {
  if (inquiries.length <= 1) return inquiries; // Don't filter if it's the only one
  const filtered = inquiries.filter(inq => {
    const typeStr = String(inq.type).toLowerCase();
    const labelStr = inq.label.toLowerCase();
    const isGreeting = GREETING_PATTERNS.test(typeStr) || GREETING_PATTERNS.test(labelStr)
      || typeStr === 'greeting' || labelStr.includes('greeting');
    return !isGreeting;
  });
  // Safety: if all were greetings somehow, return original
  return filtered.length > 0 ? filtered : inquiries;
}

/**
 * LLM-powered inquiry classification — async, called only when regex falls through.
 * Returns structured DetectedInquiry[] parsed from the LLM's JSON response.
 * Cached per message fingerprint to avoid redundant API calls.
 */
const _classifyCache = new Map<string, DetectedInquiry[]>();

export async function classifyWithLLM(
  guestMessages: string[],
  ticketProperty: string,
  ticketHostName: string,
  callAI: (opts: { systemPrompt: string; userPrompt: string }) => Promise<{ text: string }>,
  kbContext?: string,
): Promise<DetectedInquiry[]> {
  // Cache key = prompt version + guest messages + first 100 chars of KB
  // Bump PROMPT_V when prompt format changes to bust stale cache
  const PROMPT_V = 'v6';
  const cacheKey = (PROMPT_V + '|' + guestMessages.join('|') + '|' + (kbContext ?? '').slice(0, 100)).slice(0, 300);
  const cached = _classifyCache.get(cacheKey);
  if (cached) return cached;

  // Lazy-import prompts so this module stays pure (no side effects at import time)
  const { CLASSIFY_INQUIRY_SYSTEM, CLASSIFY_INQUIRY_USER, interpolate } = await import('../../ai/prompts');

  const userPrompt = interpolate(CLASSIFY_INQUIRY_USER, {
    propertyName: ticketProperty,
    hostName: ticketHostName,
    kbContext: kbContext ?? '(no knowledge base entries)',
    guestMessages: guestMessages.join('\n'),
  });

  try {
    const result = await callAI({
      systemPrompt: CLASSIFY_INQUIRY_SYSTEM,
      userPrompt,
    });

    // Parse JSON from the LLM response — strip markdown fences if present
    let jsonText = result.text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    }
    // Fix unescaped newlines inside JSON string values (model sometimes outputs real newlines)
    jsonText = jsonText.replace(/"(?:[^"\\]|\\.)*"/gs, m =>
      m.replace(/\n/g, '\\n').replace(/\r/g, '')
    );

    const parsed = JSON.parse(jsonText) as Array<{
      type: string;
      label: string;
      detail: string;
      confidence?: string;
      relevantTags?: string[];
      keywords?: string[];
      needsKbSearch?: boolean;
      context?: string;
    }>;

    if (!Array.isArray(parsed) || parsed.length === 0) {
      console.log('[InquiryDetector] LLM returned empty or non-array, keeping general fallback');
      return [];
    }

    const inquiries: DetectedInquiry[] = parsed.slice(0, 3).map((item, idx) => {
      // Clean LLM-returned keywords through the same stop-word filter
      // to prevent generic words like "policy" from causing false KB matches
      const rawKeywords = item.keywords || [];
      const cleanedKeywords = rawKeywords
        .map(kw => stem(kw.toLowerCase()))
        .filter(kw => kw.length > 2 && !STOP_WORDS.has(kw));
      // If all LLM keywords were stop words, fall back to extractKeywords
      const finalKeywords = cleanedKeywords.length > 0
        ? cleanedKeywords
        : extractKeywords(guestMessages.join(' '), item.type || 'general');

      return {
        id: `inq-ai-${idx}`,
        type: item.type || 'general',
        label: item.label || 'AI Classified',
        detail: item.detail || 'Classified by AI',
        confidence: (item.confidence as 'high' | 'medium' | 'low') || 'medium',
        relevantTags: item.relevantTags || [],
        keywords: finalKeywords,
        aiClassified: true,
        needsKbSearch: item.needsKbSearch !== false,
        context: item.context || '',
      };
    });

    _classifyCache.set(cacheKey, inquiries);
    // Cap cache at 50 entries
    if (_classifyCache.size > 50) {
      const firstKey = _classifyCache.keys().next().value;
      if (firstKey) _classifyCache.delete(firstKey);
    }

    console.log('[InquiryDetector] LLM classified %d inquiries: %s',
      inquiries.length, inquiries.map(i => i.type).join(', '));
    return inquiries;
  } catch (err) {
    console.error('[InquiryDetector] LLM classification failed:', err);
    return []; // Fall back to regex result (the general inquiry)
  }
}

/**
 * Score KB entries against a specific inquiry.
 * Uses exact + fuzzy keyword matching and tag overlap.
 * Returns sorted results with synthesized facts.
 */
export interface InquiryKBMatch {
  entry: KBEntry;
  score: number;
  matchReason: string;
  isActionable: boolean; // true = vendor contact, emergency; false = informational
}

export function scoreKBForInquiry(
  inquiry: DetectedInquiry,
  kbEntries: KBEntry[],
  maxResults = 4
): InquiryKBMatch[] {
  // Generic tags that are too broad to be a sole matching signal.
  // They're shared across many inquiry types (pet, noise, billing, checkout...)
  // and many KB entries, so a single hit on "Policies" alone is meaningless.
  // These tags still contribute to the score, but at reduced weight and
  // they don't count as a "real signal" by themselves.
  const GENERIC_TAGS = new Set(['policies', 'check-in', 'check-out', 'house rules', 'amenities']);

  const scored = kbEntries.map(kb => {
    let score = 0;
    const reasons: string[] = [];
    let hasRealSignal = false;
    let deferredGenericBonus = 0; // Applied only if hasRealSignal is true at the end

    // Tag overlap
    const kbTags = (kb.tags || []).map(t => t.toLowerCase());
    const tagHits = inquiry.relevantTags.filter(t => kbTags.includes(t.toLowerCase()));
    if (tagHits.length > 0) {
      // Separate specific tag hits from generic tag hits
      const specificHits = tagHits.filter(t => !GENERIC_TAGS.has(t.toLowerCase()));
      const genericHits = tagHits.filter(t => GENERIC_TAGS.has(t.toLowerCase()));

      // Specific tags get full weight and count as a real signal
      if (specificHits.length > 0) {
        score += specificHits.length * 30;
        reasons.push(`Matched tags: ${specificHits.join(', ')}`);
        hasRealSignal = true;
      }

      // Generic tags are deferred — only applied if we find a real signal
      if (genericHits.length > 0) {
        deferredGenericBonus = genericHits.length * 5;
      }
    }

    // Keyword match in KB content — exact + fuzzy
    const kbText = (kb.title + ' ' + kb.content).toLowerCase();
    const kbTextWords = kbText.split(/\W+/).filter(w => w.length > 2);
    let exactHits = 0;
    let fuzzyHits = 0;
    for (const kw of inquiry.keywords) {
      // Use word-boundary matching, not substring includes(), to prevent
      // "can" matching inside "cancellation" or "pet" inside "competition"
      if (kbTextWords.includes(kw) || new RegExp(`\\b${kw}\\b`).test(kbText)) {
        exactHits++;
      } else if (kw.length >= 4 && fuzzyMatchesText(kw, kbTextWords)) {
        fuzzyHits++;
      }
    }

    if (exactHits > 0) {
      const kwScore = Math.min(exactHits * 15, 45);
      score += kwScore;
      reasons.push(`Keywords (exact): ${exactHits}`);
      hasRealSignal = true;
    }
    if (fuzzyHits > 0) {
      // Fuzzy matches get 60% of exact weight
      const fuzzyScore = Math.min(fuzzyHits * 9, 27);
      score += fuzzyScore;
      reasons.push(`Keywords (fuzzy): ${fuzzyHits}`);
      hasRealSignal = true;
    }

    // Apply deferred bonuses only when there's a real signal
    if (hasRealSignal) {
      // Generic tag bonus
      if (deferredGenericBonus > 0) {
        score += deferredGenericBonus;
        reasons.push(`Generic tag boost: +${deferredGenericBonus}`);
      }
      // Scope bonus — tiebreaker
      if (kb.scope === 'Room') score += 20;
      else if (kb.scope === 'Property') score += 10;
      else score += 5;
    }

    // Safety net: if KB entry is from onboarding and has 3+ keyword hits,
    // guarantee a minimum score so host-provided info is never missed
    const totalKwHits = exactHits + fuzzyHits;
    if (kb.source === 'onboarding' && totalKwHits >= 3 && score < 30) {
      score = 30;
      reasons.push('Onboarding data (keyword safety net)');
    }

    // Actionable detection
    const isActionable = !!(
      kb.internal ||
      kbTags.includes('vendors') ||
      kbTags.includes('emergency') ||
      /phone|contact|call|\+\d/i.test(kb.content)
    );

    return {
      entry: kb,
      score,
      matchReason: reasons.join(' | ') || 'No match',
      isActionable,
    };
  });

  return scored
    .filter(s => s.score >= 25)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

/**
 * Synthesize KB matches into a fact sentence for an inquiry.
 */
export function synthesizeFacts(matches: InquiryKBMatch[]): string[] {
  return matches.map(m => {
    // Extract the most useful sentence from the content
    const sentences = m.entry.content.split(/\.\s+/);
    const bestSentence = sentences[0] + (sentences[0].endsWith('.') ? '' : '.');
    return bestSentence;
  });
}

/**
 * Compose a multi-part reply from inquiry decisions.
 */
export interface InquiryDecision {
  inquiryId: string;
  decision: 'yes' | 'no' | 'custom';
  customNote?: string;
}

export function composeReply(
  guestFirstName: string,
  hostTone: string,
  inquiries: DetectedInquiry[],
  decisions: Record<string, InquiryDecision>,
  kbMatchesByInquiry: Record<string, InquiryKBMatch[]>,
  agentName: string
): string {
  const isHighEnd = hostTone.toLowerCase().includes('professional') || hostTone.toLowerCase().includes('high-end');
  const isCasual = hostTone.toLowerCase().includes('casual') || hostTone.toLowerCase().includes('friendly');

  // Greeting
  let greeting: string;
  if (isHighEnd) {
    greeting = `Dear ${guestFirstName},\n\nThank you for reaching out. I'm happy to assist you.`;
  } else if (isCasual) {
    greeting = `Hey ${guestFirstName}!\n\nThanks for letting us know.`;
  } else {
    greeting = `Hi ${guestFirstName},\n\nThank you for contacting us.`;
  }

  const paragraphs: string[] = [greeting];

  for (const inquiry of inquiries) {
    const decision = decisions[inquiry.id];
    if (!decision) continue;

    const matches = kbMatchesByInquiry[inquiry.id] || [];
    const guestFacingMatches = matches.filter(m => !m.entry.internal);
    const facts = synthesizeFacts(guestFacingMatches);

    if (decision.decision === 'yes') {
      // Affirmative response using KB data
      let para = '';
      if (inquiry.type === 'maintenance') {
        para = `Regarding the ${inquiry.detail.toLowerCase()}: I've arranged for our maintenance team to look into this right away.`;
        if (facts.length > 0) para += ` ${facts[0]}`;
      } else if (inquiry.type === 'wifi') {
        para = `About the Wi-Fi:`;
        if (facts.length > 0) para += ` ${facts.join(' ')}`;
        else para += ` I'll send you the connection details shortly.`;
      } else if (inquiry.type === 'checkout') {
        para = `Great news — we can accommodate your late checkout request.`;
        if (facts.length > 0) para += ` ${facts[0]}`;
      } else if (inquiry.type === 'noise') {
        para = `I'm very sorry about the noise disturbance. I'm addressing this immediately with the neighboring unit.`;
        if (facts.length > 0) para += ` For reference: ${facts[0]}`;
      } else if (inquiry.type === 'luggage') {
        para = `Regarding your luggage:`;
        if (facts.length > 0) para += ` ${facts[0]}`;
        else para += ` I'll look into storage options for you.`;
      } else if (inquiry.type === 'directions') {
        para = `For getting here:`;
        if (facts.length > 0) para += ` ${facts[0]}`;
        else para += ` I recommend using a ride-hailing service from the airport.`;
      } else if (inquiry.type === 'checkin') {
        para = `About your check-in:`;
        if (facts.length > 0) para += ` ${facts[0]}`;
      } else if (inquiry.type === 'pet') {
        para = `Regarding your question about pets:`;
        if (facts.length > 0) para += ` ${facts[0]}`;
        else para += ` I'll check on our pet policy and get back to you shortly.`;
      } else {
        // AI-classified or generic — use the label for a natural opener
        if (inquiry.aiClassified && inquiry.label) {
          para = `Regarding your ${inquiry.label.toLowerCase()}:`;
          if (facts.length > 0) para += ` ${facts[0]}`;
          else para += ` I'll look into this and get back to you shortly.`;
        } else {
          para = facts.length > 0 ? facts.join(' ') : `I'll look into this and get back to you shortly.`;
        }
      }
      paragraphs.push(para);
    } else if (decision.decision === 'no') {
      // Decline response
      let para = '';
      if (inquiry.type === 'checkout') {
        para = `Unfortunately, we're unable to offer a late checkout for your dates due to a scheduled turnover.`;
        if (facts.length > 0) para += ` Our standard policy: ${facts[0]}`;
      } else if (inquiry.type === 'luggage') {
        para = `I'm afraid early luggage drop-off isn't available for this property.`;
        if (facts.length > 0) para += ` ${facts[0]}`;
      } else {
        para = `Regarding your ${inquiry.label.toLowerCase()} �� unfortunately we're unable to accommodate this request at the moment.`;
      }
      paragraphs.push(para);
    } else if (decision.decision === 'custom' && decision.customNote) {
      paragraphs.push(decision.customNote);
    }
  }

  // Closing
  let closing: string;
  if (isHighEnd) {
    closing = `Please don't hesitate to reach out if you need anything else.\n\nWarm regards,\n${agentName}`;
  } else if (isCasual) {
    closing = `Let me know if there's anything else I can help with!\n\nCheers,\n${agentName}`;
  } else {
    closing = `Feel free to reach out if you have any other questions.\n\nBest,\n${agentName}`;
  }
  paragraphs.push(closing);

  return paragraphs.join('\n\n');
}