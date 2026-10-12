import type { DocType } from "./docTypes";

export type { DocType };

/**
 * Title patterns used to split a combined DMS package into documents.
 * Edit this file only - the patterns live nowhere else.
 *
 * Every pattern carries an id so the ingestion report can say which rule
 * matched without ever repeating the text it matched on.
 */
export const DOC_TYPE_PATTERNS: ReadonlyArray<{
  type: DocType;
  patterns: ReadonlyArray<{ id: string; re: RegExp }>;
}> = [
  {
    type: "buyers_order",
    patterns: [
      { id: "bo.order", re: /buyer'?s\s+order/i },
      { id: "bo.purchase", re: /purchase\s+agreement/i },
      { id: "bo.vpo", re: /vehicle\s+purchase\s+order/i },
    ],
  },
  {
    type: "retail_installment_contract",
    patterns: [
      { id: "ric.retail", re: /retail\s+installment/i },
      { id: "ric.sale", re: /installment\s+sale\s+contract/i },
      { id: "ric.holder", re: /any\s+holder\s+of\s+this\s+consumer\s+credit\s+contract/i },
    ],
  },
  {
    type: "odometer_disclosure",
    patterns: [
      { id: "odo.statement", re: /odometer\s+disclosure\s+statement/i },
      { id: "odo.disclosure", re: /odometer\s+disclosure/i },
      { id: "odo.plain", re: /odometer\s+statement/i },
    ],
  },
  {
    type: "reassignment_of_title",
    patterns: [
      { id: "rat.reassign", re: /reassignment\s+of\s+title/i },
      { id: "rat.dealer", re: /dealer\s+reassignment/i },
    ],
  },
  {
    type: "buyers_guide",
    patterns: [
      { id: "bg.guide", re: /buyers?\s+guide/i },
      { id: "bg.asis", re: /as\s*-?\s*is\s+no\s+warranty/i },
    ],
  },
  {
    type: "e_sign_consent",
    patterns: [
      { id: "esign.consent", re: /e\s*-?\s*sign\s+consent/i },
      {
        id: "esign.electronic",
        re: /consent\s+to\s+(the\s+)?use\s+of\s+electronic\s+(records|signatures)/i,
      },
      { id: "esign.disclosure", re: /electronic\s+signature\s+(consent|disclosure)/i },
    ],
  },
  {
    type: "temporary_permit",
    patterns: [
      { id: "temp.permit", re: /temporary\s+permit/i },
      { id: "temp.registration", re: /temporary\s+registration/i },
    ],
  },
  {
    type: "risk_based_pricing_notice",
    patterns: [
      { id: "rbp.score", re: /your\s+credit\s+score\s+and\s+the\s+price\s+you\s+pay/i },
      { id: "rbp.riskbased", re: /risk\s*-?\s*based\s+pricing/i },
      { id: "rbp.noticeToHome", re: /credit\s+score\s+disclosure\s+notice/i },
    ],
  },
  {
    type: "theft_recovery_agreement",
    patterns: [
      { id: "theft.location", re: /vehicle\s+location\s+and\s+theft\s+recovery/i },
      { id: "theft.recovery", re: /theft\s+recovery\s+(device|system)?\s*agreement/i },
    ],
  },
  {
    type: "gap_addendum",
    patterns: [
      { id: "gap.addendum", re: /gap\s+addendum/i },
      { id: "gap.guaranteed", re: /guaranteed\s+asset\s+protection/i },
    ],
  },
  {
    type: "gap_disclosure",
    patterns: [{ id: "gap.disclosure", re: /gap\s+disclosure/i }],
  },
  {
    type: "itemization_of_sale",
    patterns: [
      { id: "item.sale", re: /itemization\s+of\s+sale/i },
      { id: "item.financed", re: /itemization\s+of\s+(the\s+)?amount\s+financed/i },
    ],
  },
  {
    type: "vehicle_service_contract",
    patterns: [
      { id: "vsc.contract", re: /vehicle\s+service\s+contract/i },
      { id: "vsc.plan", re: /selected\s+plan\s+coverage/i },
    ],
  },
  {
    type: "satellite_radio_trial",
    patterns: [
      { id: "radio.trial", re: /radio\s+trial\s+subscription/i },
      { id: "radio.satellite", re: /satellite\s+radio\s+trial/i },
    ],
  },
  { type: "privacy_notice", patterns: [{ id: "pn.notice", re: /privacy\s+(notice|policy)/i }] },
  { type: "arbitration_agreement", patterns: [{ id: "arb.any", re: /arbitration/i }] },
  { type: "power_of_attorney", patterns: [{ id: "poa.any", re: /power\s+of\s+attorney/i }] },
  {
    type: "state_title_application",
    patterns: [
      { id: "title.certificate", re: /application\s+for\s+certificate\s+of\s+title/i },
      { id: "title.stateForm", re: /\bTC\s*-\s*\d{2,4}\b/i },
    ],
  },
  {
    type: "title_application",
    patterns: [
      { id: "ta.application", re: /application\s+for\s+(certificate\s+of\s+)?title/i },
      { id: "ta.plain", re: /title\s+application/i },
    ],
  },
  {
    type: "we_owe",
    patterns: [
      { id: "weowe.any", re: /we\s+owe/i },
      { id: "weowe.dueBill", re: /due\s+bill/i },
    ],
  },
  {
    type: "credit_application",
    patterns: [
      { id: "credit.application", re: /credit\s+application/i },
      { id: "credit.forCredit", re: /application\s+for\s+credit/i },
    ],
  },
];

/**
 * Markers that say "this page belongs to the form that started before it".
 * They live here next to the title patterns on purpose.
 */
export const CONTINUATION_PATTERNS: ReadonlyArray<RegExp> = [
  // "page 1 of 2" starts a form, so only pages 2 and up count as a continuation.
  /page\s*(?!1\b)\d+/i,
  /p[aá]gina\s*(?!1\b)\d+/i,

  /continued/i,
  /\(\s*cont\.?\s*\)/i,
  /cont(inua[cç][aã]o|inued\s+from)/i,
  /reverse\s+side/i,
  /back\s+of\s+(this\s+)?form/i,
];

/**
 * Some forms are typeset with letter-spacing, so extraction returns
 * "F O RM  N O ." instead of "FORM NO.". Runs of single characters separated
 * by single spaces are glued back together before anything is matched.
 */
function collapseLetterSpacing(text: string): string {
  return text.replace(/(?:(?<![^\s])[A-Za-z0-9](?: |\u00a0)){2,}[A-Za-z0-9](?![^\s])/g, (run) =>
    run.replace(/[ \u00a0]/g, ""),
  );
}

/** Straight quotes, single spaces, no letter-spacing. The original text is never stored. */
export function normalizeText(text: string): string {
  const straight = text
    .replace(/[\u2018\u2019\u02BC\u00B4\u0060]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u00a0\t\r\n]+/g, " ");
  // Collapse letter-spacing first: it needs the single spaces to find the runs.
  return collapseLetterSpacing(straight).replace(/ {2,}/g, " ").trim();
}

/** True when the page text carries a "page 2 / continued / reverse side" marker. */
export function hasContinuationMarker(topText: string): boolean {
  const text = normalizeText(topText);
  return CONTINUATION_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Some forms are typeset so widely that extraction breaks the title into
 * pieces no rule can match ("ITE M IZA TIO N O F"). Matching a spaceless copy
 * of the text with a spaceless copy of the rule catches those.
 */
const looseCache = new Map<string, RegExp>();
function loosePattern(re: RegExp): RegExp {
  const cached = looseCache.get(re.source);
  if (cached) return cached;
  const loose = new RegExp(re.source.replace(/\\s\+/g, "\\s*").replace(/ /g, ""), re.flags);
  looseCache.set(re.source, loose);
  return loose;
}

/** Detects a form title. Returns the type and the pattern id that matched. */
export function detectDocTypeMatch(topText: string): { type: DocType; patternId: string } | null {
  const text = normalizeText(topText);
  for (const entry of DOC_TYPE_PATTERNS) {
    for (const pattern of entry.patterns) {
      if (pattern.re.test(text)) return { type: entry.type, patternId: pattern.id };
    }
  }
  const squeezed = text.replace(/\s+/g, "");
  for (const entry of DOC_TYPE_PATTERNS) {
    for (const pattern of entry.patterns) {
      if (loosePattern(pattern.re).test(squeezed))
        return { type: entry.type, patternId: pattern.id };
    }
  }
  return null;
}

/** Detects a form title in the top area of a page. Returns null when nothing matches. */
export function detectDocType(topText: string): DocType | null {
  return detectDocTypeMatch(topText)?.type ?? null;
}

/** "Page 3 of 15", "Page 2", "4 of 5". */
export type PageMarker = { page: number; of: number | null };

export function detectPageMarker(text: string): PageMarker | null {
  const normalized = normalizeText(text);
  const withOf =
    /\b(?:page|p[aá]gina|pg\.?)\s*(\d{1,3})\s*(?:of|de|\/)\s*(\d{1,3})\b/i.exec(normalized) ??
    /\b(\d{1,3})\s*(?:of|de)\s*(\d{1,3})\b/i.exec(normalized);
  if (withOf) {
    const page = Number(withOf[1]);
    const of = Number(withOf[2]);
    if (page >= 1 && of >= 1 && page <= of && of <= 200) return { page, of };
  }
  const plain = /\b(?:page|p[aá]gina|pg\.)\s*(\d{1,3})\b/i.exec(normalized);
  if (plain) {
    const page = Number(plain[1]);
    if (page >= 1 && page <= 200) return { page, of: null };
  }
  return null;
}

/**
 * Most forms print a stable code in the header or the footer, for example
 * "AWS-Z195", "553-UT-ARB" or "CAIODOM_M1". A code is an alphanumeric token of
 * four characters or more that carries a dash or an underscore; plain words
 * are too common to be trusted as a form code.
 */
const FORM_CODE_RE = /\b[A-Z0-9]{2,}(?:[-_][A-Z0-9]{1,}){1,4}\b/g;
/** Dates, phone numbers and "page 1 of 5" must never be read as a form code. */
const NOT_A_CODE = [
  /^\d{1,4}([-_]\d{1,4}){1,3}$/, // 04-25-2026, 1-800-555
  /^(PAGE|P[AÁ]GINA)[-_]/i,
  /^[A-Z]{1,2}$/,
  /^REV/, // revision stamps such as REV-0425
];

/**
 * A printed form code mixes letters and digits ("AWS-Z195", "553-UT-ARB").
 * Tokens with only letters are names ("SMITH-JONES"); tokens that are almost
 * all digits are a ZIP+4, a deal or stock number ("84043-1234", "10234-B").
 * Those are customer data, change from deal to deal, and would merge a whole
 * package into one document, so they are never codes.
 */
function looksLikeFormCode(token: string): boolean {
  const characters = token.replace(/[-_]/g, "");
  if (characters.length < 4) return false;
  const digits = (characters.match(/\d/g) ?? []).length;
  const letters = characters.length - digits;
  if (digits === 0 || letters === 0) return false;
  return digits / characters.length < 0.7;
}

export function detectFormCode(text: string): string | null {
  const normalized = normalizeText(text).toUpperCase();
  const seen = new Map<string, number>();
  for (const match of normalized.matchAll(FORM_CODE_RE)) {
    const token = match[0];
    if (!looksLikeFormCode(token)) continue;
    if (NOT_A_CODE.some((re) => re.test(token))) continue;
    seen.set(token, (seen.get(token) ?? 0) + 1);
  }
  if (seen.size === 0) return null;
  // The longest token is the most specific one: "LAW 553-UT-ARB-EPS" wins over "UT-ARB".
  return [...seen.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b))[0] ?? null;
}
