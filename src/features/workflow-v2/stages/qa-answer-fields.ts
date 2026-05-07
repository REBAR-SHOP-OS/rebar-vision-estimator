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

const FIELD_DEFS: Record<string, EngineerAnswerField> = {
  length: { key: "length", label: "Length", placeholder: "e.g. 3000mm" },
  width: { key: "width", label: "Width", placeholder: "e.g. 1200mm" },
  height: { key: "height", label: "Height", placeholder: "e.g. 203mm" },
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
  const spacing = spacingMatch ? `at ${spacingMatch[1].trim()} O.C` : null;
  return [length, bar, "dowels", spacing]
    .filter(Boolean)
    .join(" ")
    .trim();
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
  if (/\b(height|high|depth|thick|thickness)\b/.test(haystack)) addField(keys, "height");
  if (/\b(bar|rebar|callout|spacing|o\.?c\.?|@\b|15m|20m|10m|25m)\b/.test(haystack)) addField(keys, "bar_callout");
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
  const missingRefs = input.missingRefs || [];
  const sourceText = `${input.title || ""}\n${input.description || ""}\n${input.sourceExcerpt || ""}`;
  const fields = inferEngineerAnswerFields(missingRefs, sourceText);
  const loc = input.locationLabel || (input.pageNumber ? `P${input.pageNumber}` : "the highlighted drawing area");
  const excerpt = String(input.sourceExcerpt || "").trim();

  if (isLevelingPadDowelCallout(sourceText)) {
    const callout = extractLevelingPadDowelCallout(excerpt || sourceText) || "the dowel spacing callout";
    return `On ${loc}, find the C.I.P. concrete leveling pad into foundation wall. The callout requires ${callout}. What is the full leveling pad run length, and how many dowels are required?`;
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
  return `On ${loc}, find the ${object}. What ${ask} should be used for this item?${excerptClause}`;
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
