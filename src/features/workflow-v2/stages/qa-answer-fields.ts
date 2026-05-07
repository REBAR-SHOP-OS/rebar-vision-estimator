export type EngineerAnswerField = {
  key: string;
  label: string;
  placeholder: string;
};

type SmartQuestionInput = {
  locationLabel?: string | null;
  pageNumber?: number | null;
  objectIdentity?: string | null;
  description?: string | null;
  title?: string | null;
  sourceExcerpt?: string | null;
  missingRefs?: string[];
};

export type EngineerAnswerDraft = {
  question: string;
  draftAnswer: string;
  confidence: "high" | "medium" | "low";
  needsConfirmation: boolean;
  structuredValues: Record<string, string>;
};

const FIELD_DEFS: Record<string, EngineerAnswerField> = {
  length: { key: "length", label: "Length", placeholder: "e.g. 3000mm" },
  width: { key: "width", label: "Width", placeholder: "e.g. 1200mm" },
  height: { key: "height", label: "Height", placeholder: "e.g. 203mm" },
  thickness: { key: "thickness", label: "Thickness", placeholder: "e.g. 152mm" },
  bar_callout: { key: "bar_callout", label: "Bar callout", placeholder: "e.g. 15M @ 406mm O.C." },
  quantity: { key: "quantity", label: "Quantity", placeholder: "e.g. 2" },
  notes: { key: "notes", label: "Notes", placeholder: "Optional drawing note or assumption" },
  answer: { key: "answer", label: "Answer", placeholder: "Enter the drawing value" },
};

function addField(keys: Set<string>, key: string) {
  if (FIELD_DEFS[key]) keys.add(key);
}

function isLevelingPadDowelCallout(text: string): boolean {
  const t = text.toLowerCase();
  return /\bdowels?\b/.test(t)
    && /\b\d+\s*m\b/.test(t)
    && /\bo\.?\s*c\.?\b|@\s*\d+/.test(t)
    && /level(?:l)?ing\s+pad/.test(t)
    && /foundation\s+wall/.test(t);
}

function extractLevelingPadDowelCallout(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const length = normalized.match(/\b\d+\s*mm\s*(?:\([^)]*\)\s*)?long\b/i)?.[0].toLowerCase();
  const bar = normalized.match(/\b\d+\s*M\b/i)?.[0].toUpperCase();
  const spacingMatch = normalized.match(/(?:at|@)\s*(\d+\s*mm\s*(?:\([^)]*\)\s*)?)O\.?\s*C\.?/i);
  const spacing = spacingMatch ? `@ ${spacingMatch[1].trim()} O.C.` : null;
  return [length, bar, "dowels", spacing]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function normalizeCalloutText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\bW\/\b/gi, "with")
    .replace(/@(?=\w)/g, "at ")
    .replace(/\bEA\.?\s*WAY\b/gi, "each way")
    .replace(/\bE\.?\s*W\.?\b/gi, "each way")
    .replace(/\bO\.?\s*C\.?\b/gi, "O.C.")
    .replace(/O\.C\.\./gi, "O.C.")
    .replace(/\bCENTRE\b/gi, "centre")
    .replace(/\bCENTER\b/gi, "centre")
    .trim();
}

function extractThickness(text: string): string | null {
  const normalized = normalizeCalloutText(text);
  return normalized.match(/\b\d+\s*mm\b(?=\s+(?:frost\s+slab|foundation\s+wall|slab|wall|pad|footing)\b)/i)?.[0].replace(/\s+/g, "") || null;
}

function extractRebarCallout(text: string): string | null {
  const normalized = normalizeCalloutText(text);
  const match = normalized.match(/\b(10M|15M|20M|25M|30M|35M)\s*@\s*(\d+\s*mm)\s*O\.C\.?/i);
  if (!match) return null;
  const tail = normalized.slice((match.index || 0) + match[0].length);
  const qualifierMatch = tail.match(/^[\s.:-]*(each way|e\/w|vert(?:ical)?|horiz(?:ontal)?)/i);
  const qualifier = qualifierMatch ? ` ${qualifierMatch[1].toLowerCase().replace("e/w", "each way")}` : "";
  return `${match[1].toUpperCase()} @ ${match[2].replace(/\s+/g, "")} O.C.${qualifier}`;
}

function cleanDescriptiveCallout(value: string): string {
  return normalizeCalloutText(value)
    .replace(/\bFOUNDATION\s+WALL\b/gi, "foundation wall")
    .replace(/\bCONTINUOUS\b/gi, "continuous")
    .replace(/\bHORIZONTAL\b/gi, "horizontal")
    .replace(/\bVERTICAL\b/gi, "vertical")
    .replace(/\bBARS?\b/gi, (m) => m.toLowerCase())
    .replace(/\bHOOK\b/gi, "hook")
    .replace(/\bTOP\b/gi, "top")
    .replace(/\bAT\s+TOP\b/gi, "at top")
    .replace(/\bWITH\b/gi, "with")
    .replace(/\s+/g, " ")
    .replace(/\s+([.;,])/g, "$1")
    .replace(/[.;,\s]+$/g, "")
    .trim();
}

function extractDescriptiveRebarCallout(text: string): string | null {
  const normalized = normalizeCalloutText(text);
  const barMatch = normalized.match(/\b(?:continuous\s+)?(?:horizontal|vertical)\s+bars?\b/i);
  if (!barMatch) return null;

  const start = barMatch.index || 0;
  const after = normalized.slice(start);
  const hook = after.match(/\b\d+\s*mm\s*(?:\([^)]*\)\s*)?hook\b/i)?.[0];
  const location = after.match(/\bat\s+(?:the\s+)?top\s+of\s+foundation\s+wall\b/i)?.[0]
    || after.match(/\bat\s+(?:the\s+)?(?:top|bottom|middle)\b/i)?.[0];
  const raw = [
    barMatch[0],
    location,
    hook ? `with ${hook}` : null,
  ].filter(Boolean).join(" ");
  return cleanDescriptiveCallout(raw);
}

function extractPlacementNote(text: string): string | null {
  const normalized = normalizeCalloutText(text);
  const match = normalized.match(/\b(?:in|at)\s+the\s+(centre|center|middle|top|bottom)\s+of\s+(?:the\s+)?([a-z\s]+?)(?:[.;,]|$)/i);
  if (!match) return null;
  return `in the ${match[1].toLowerCase().replace("center", "centre")} of ${match[2].trim().toLowerCase()}`;
}

function inferDrawingObject(text: string, fallback?: string | null): string {
  const t = text.toLowerCase();
  if (/frost\s+slab/.test(t)) return "frost slab";
  if (/\bslab\b/.test(t)) return "slab";
  if (/foundation\s+wall|frost\s+wall|\bwall\b/.test(t)) return "foundation wall";
  if (/strip\s+footing|wall\s+footing|footing/.test(t)) return "footing";
  if (/housekeeping\s+pad|level(?:l)?ing\s+pad|equipment\s+pad/.test(t)) return "pad";
  return fallback || "drawing item";
}

function missingDimensionAsk(object: string, missingRefs: string[]): string {
  const missing = missingRefs.join(" ").toLowerCase();
  if (/slab/.test(object)) return "slab length and width";
  if (/wall/.test(object)) return "wall length and height";
  if (/pad/.test(object)) return "pad length and width";
  if (/footing/.test(object)) return "footing length";
  if (/dimension|length|width|height/.test(missing)) return "length and width";
  return "remaining drawing dimensions";
}

function asSentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function extractSpacingMm(text: string): number | null {
  const match = text.match(/(?:at|@)\s*(\d+(?:\.\d+)?)\s*mm\s*(?:\([^)]*\)\s*)?O\.?\s*C\.?/i);
  return match ? Number(match[1]) : null;
}

function extractRunLengthMm(text: string): number | null {
  const normalized = text.replace(/\s+/g, " ");
  const explicit = normalized.match(/\b(?:run|pad|length)\s*(?:length)?\s*(?:is|=|:)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(mm|m)\b/i);
  if (!explicit) return null;
  const value = Number(explicit[1].replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  return explicit[2].toLowerCase() === "m" ? value * 1000 : value;
}

function formatMm(value: number): string {
  return `${Math.round(value)}mm`;
}

export function inferEngineerAnswerFields(missingRefs: string[] = [], text = ""): EngineerAnswerField[] {
  const haystack = `${missingRefs.join(" ")} ${text}`.toLowerCase().replace(/[^a-z0-9@.]+/g, " ");
  const keys = new Set<string>();

  if (isLevelingPadDowelCallout(`${missingRefs.join(" ")} ${text}`)) {
    addField(keys, "length");
    addField(keys, "quantity");
    addField(keys, "bar_callout");
    addField(keys, "notes");
    return Array.from(keys).map((key) => FIELD_DEFS[key]);
  }

  if (/\b(length|run|perimeter|edge|dimension|dimensions|long)\b/.test(haystack)) addField(keys, "length");
  if (/\b(width|wide)\b/.test(haystack)) addField(keys, "width");
  if (/\b(height|high|depth)\b/.test(haystack)) addField(keys, "height");
  if (/\b(thick|thickness)\b/.test(haystack) || extractThickness(text)) addField(keys, "thickness");
  if (/\b(bar|rebar|callout|spacing|o\.?c\.?|@\b|15m|20m|10m|25m|hook)\b/.test(haystack) || extractDescriptiveRebarCallout(text)) addField(keys, "bar_callout");
  if (/\b(quantity|qty|count|number)\b/.test(haystack)) addField(keys, "quantity");

  if (keys.size === 0) addField(keys, "answer");
  addField(keys, "notes");
  return Array.from(keys).map((key) => FIELD_DEFS[key]);
}

export function summarizeEngineerAnswer(values: Record<string, string>): string {
  const parts = Object.entries(values)
    .map(([key, value]) => [key, String(value || "").trim()] as const)
    .filter(([, value]) => value.length > 0)
    .map(([key, value]) => `${FIELD_DEFS[key]?.label || key}: ${value}`);
  return parts.length ? parts.join("; ") : "No engineer answer entered.";
}

export function buildEngineerQuestion(input: SmartQuestionInput): string {
  return buildEngineerAnswerDraft(input).question;
}

export function buildEngineerAnswerDraft(input: SmartQuestionInput): EngineerAnswerDraft {
  const missingRefs = input.missingRefs || [];
  const sourceText = `${input.title || ""}\n${input.description || ""}\n${input.sourceExcerpt || ""}`;
  const fields = inferEngineerAnswerFields(missingRefs, sourceText);
  const loc = input.locationLabel || (input.pageNumber ? `P${input.pageNumber}` : "the highlighted drawing area");
  const excerpt = String(input.sourceExcerpt || "").trim();

  if (isLevelingPadDowelCallout(sourceText)) {
    const callout = extractLevelingPadDowelCallout(excerpt || sourceText) || "the dowel spacing callout";
    const spacingMm = extractSpacingMm(excerpt || sourceText);
    const runLengthMm = extractRunLengthMm(sourceText);
    const quantity = runLengthMm && spacingMm ? Math.floor(runLengthMm / spacingMm) + 1 : null;
    const question = `On ${loc}, find the C.I.P. concrete leveling pad into foundation wall. The callout requires ${asSentence(callout)} What is the full leveling pad run length, and how many dowels are required?`;
    const structuredValues: Record<string, string> = { bar_callout: callout };
    if (runLengthMm) structuredValues.length = formatMm(runLengthMm);
    if (quantity) structuredValues.quantity = `${quantity}`;
    const draftAnswer = quantity && runLengthMm
      ? `Found: run length ${formatMm(runLengthMm)}; use ${callout}; quantity = ${quantity} dowels. Please confirm.`
      : `Found: ${callout} from C.I.P. concrete leveling pad into foundation wall. Please confirm the full leveling pad run length so dowel quantity can be calculated.`;
    return {
      question,
      draftAnswer,
      confidence: quantity ? "high" : "medium",
      needsConfirmation: true,
      structuredValues,
    };
  }

  const visibleThickness = extractThickness(sourceText);
  const visibleBarCallout = extractRebarCallout(sourceText) || extractDescriptiveRebarCallout(sourceText);
  if (visibleThickness || visibleBarCallout) {
    const object = inferDrawingObject(sourceText, input.objectIdentity);
    const dimensions = missingDimensionAsk(object, missingRefs);
    const placement = extractPlacementNote(sourceText);
    const visibleParts = [
      visibleThickness ? `${visibleThickness} ${object}` : object,
      visibleBarCallout ? `with ${visibleBarCallout}` : null,
      placement,
    ].filter(Boolean).join(" ");
    const structuredValues: Record<string, string> = {};
    if (visibleThickness) structuredValues.thickness = visibleThickness;
    if (visibleBarCallout) structuredValues.bar_callout = visibleBarCallout;
    if (placement) structuredValues.notes = placement;
    return {
      question: `On ${loc}, find the ${object}. The drawing shows ${asSentence(visibleParts)} What ${dimensions} should be used?`,
      draftAnswer: `Found: ${visibleThickness ? `${visibleThickness} ${object}` : object}${visibleBarCallout ? `; rebar ${visibleBarCallout}` : ""}${placement ? ` ${placement}` : ""}. Please confirm the ${dimensions}.`,
      confidence: "medium",
      needsConfirmation: true,
      structuredValues,
    };
  }

  const needed = fields
    .filter((field) => field.key !== "notes" && field.key !== "answer")
    .map((field) => field.label.toLowerCase());
  const ask = needed.length
    ? needed.length === 1
      ? needed[0]
      : `${needed.slice(0, -1).join(", ")} and ${needed[needed.length - 1]}`
    : "the exact drawing value";
  const object = input.objectIdentity || inferObjectFromText(`${input.title || ""} ${input.description || ""}`) || "highlighted item";
  const excerptClause = excerpt ? ` Use the callout/excerpt "${excerpt.slice(0, 120)}".` : "";
  const found = excerpt
    ? `Found source excerpt: "${excerpt.slice(0, 160)}".`
    : `Found the ${object} at ${loc}.`;
  return {
    question: `On ${loc}, find the ${object}. What ${ask} should be used for this item?${excerptClause}`,
    draftAnswer: `${found} Please confirm ${ask} for this item.`,
    confidence: "low",
    needsConfirmation: true,
    structuredValues: {},
  };
}

function inferObjectFromText(text: string): string | null {
  const t = text.toLowerCase();
  if (/housekeeping\s*pad|leveling\s*pad|equipment\s*pad/.test(t)) return "housekeeping pad";
  if (/foundation\s*wall|frost\s*wall|stem\s*wall|\bwall\b/.test(t)) return "foundation wall";
  if (/strip\s*footing|wall\s*footing|footing/.test(t)) return "footing";
  if (/slab\s*edge|frost\s*slab|slab/.test(t)) return "slab";
  if (/column|pier|pocket/.test(t)) return "column or pier";
  return null;
}
