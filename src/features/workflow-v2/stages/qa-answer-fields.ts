export type EngineerAnswerField = {
  key: string;
  label: string;
  placeholder: string;
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

export function inferEngineerAnswerFields(missingRefs: string[] = [], text = ""): EngineerAnswerField[] {
  const haystack = `${missingRefs.join(" ")} ${text}`.toLowerCase().replace(/[^a-z0-9@.]+/g, " ");
  const keys = new Set<string>();

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
