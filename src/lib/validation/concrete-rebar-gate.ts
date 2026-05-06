/**
 * Concrete = Rebar axiom (universal across all project types).
 *
 * Wherever a structural drawing mentions a concrete element, there MUST be at
 * least one rebar (or WWM) line associated with it. This gate scans OCR text
 * for known concrete keywords and flags any keyword whose family has zero
 * matching estimate rows.
 *
 * Pure function, no I/O — call from edge functions or client validation.
 */

const CONCRETE_FAMILIES: Array<{ key: string; rx: RegExp }> = [
  { key: "FOOTING",     rx: /\b(FOOTING|FTG|F\d+)\b/i },
  { key: "PIER",        rx: /\b(PIER|P\d+)\b/i },
  { key: "PILE_CAP",    rx: /\b(PILE.?CAP|PC\d+)\b/i },
  { key: "WALL",        rx: /\b(WALL|FROST.?WALL|RETAINING|FW\d+|W\d+)\b/i },
  { key: "COLUMN",      rx: /\b(COLUMN|COL\b|C\d+)\b/i },
  { key: "BEAM",        rx: /\b(BEAM|GRADE.?BEAM|GB\d+|B\d+)\b/i },
  { key: "SLAB",        rx: /\b(SLAB|SOG|SLAB.?ON.?GRADE|S\d+)\b/i },
  { key: "STAIR",       rx: /\b(STAIR|STR\d+)\b/i },
  { key: "LEDGE",       rx: /\b(LEDGE|L\d+)\b/i },
  { key: "EQUIPMENT_PAD", rx: /\b(EQUIPMENT.?PAD|EP\d+|PAD)\b/i },
];

export interface ConcreteRebarIssue {
  family: string;
  title: string;
  description: string;
  severity: "error";
  issue_type: "MISSING_REBAR";
}

export function checkConcreteRebar(opts: {
  ocrText: string;
  estimateRows: Array<{ description?: string | null }>;
}): ConcreteRebarIssue[] {
  const text = String(opts.ocrText || "");
  const descs = (opts.estimateRows || [])
    .map((r) => String(r?.description || "").toUpperCase())
    .join(" | ");
  const issues: ConcreteRebarIssue[] = [];
  for (const fam of CONCRETE_FAMILIES) {
    if (!fam.rx.test(text)) continue;
    if (fam.rx.test(descs)) continue;
    issues.push({
      family: fam.key,
      issue_type: "MISSING_REBAR",
      severity: "error",
      title: `Missing rebar for ${fam.key.replace(/_/g, " ").toLowerCase()}`,
      description: `Drawing OCR mentions ${fam.key.replace(/_/g, " ").toLowerCase()} but no rebar / WWM line was estimated. Concrete = Rebar axiom violated — verify drawings or add the missing line.`,
    });
  }
  return issues;
}