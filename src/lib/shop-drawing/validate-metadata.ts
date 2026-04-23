/**
 * Trust-First Shop Drawing — Phase 1 metadata validator.
 * Pure function. No I/O, no side effects.
 * Catches the common bugs we've seen on real exports:
 *   - Malformed dates like "2022-15"
 *   - Discipline typos like "Architectral"
 *   - Missing required fields per render mode
 */

export type DrawingMode = "ai_draft" | "review_draft" | "issued";

export interface ValidationIssue {
  field: string;
  severity: "error" | "warning";
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export interface DrawingMetadata {
  projectName?: string | null;
  clientName?: string | null;
  sheetNumber?: string | null;
  scale?: string | null;
  discipline?: string | null;
  issueDate?: string | null; // YYYY-MM-DD
  drawnBy?: string | null;
  checkedBy?: string | null;
  approvedBy?: string | null;
  reviewerName?: string | null;
  unresolvedIssueCount?: number;
}

const CANONICAL_DISCIPLINES = [
  "Architectural",
  "Structural",
  "Civil",
  "Mechanical",
  "Electrical",
  "Plumbing",
  "Landscape",
];

/** Common drafting typos we auto-correct before they reach an export. */
const TYPO_FIXES: Array<[RegExp, string]> = [
  [/\bArchitectral\b/gi, "Architectural"],
  [/\bStuctural\b/gi, "Structural"],
  [/\bStructual\b/gi, "Structural"],
  [/\bMechnical\b/gi, "Mechanical"],
  [/\bElectical\b/gi, "Electrical"],
  [/\bPlumming\b/gi, "Plumbing"],
];

const KNOWN_TYPOS = new Set(["architectral", "stuctural", "structual", "mechnical", "electical", "plumming"]);

/**
 * Normalize a free-text label (project name, discipline, etc.) by auto-fixing
 * known drafting typos. Returns the corrected text and the list of fixes applied
 * so callers can surface them as warnings.
 */
export function normalizeProjectName(input: string | null | undefined): {
  normalized: string;
  fixes: Array<{ from: string; to: string }>;
} {
  const raw = (input ?? "").toString();
  if (!raw.trim()) return { normalized: raw, fixes: [] };
  let out = raw;
  const fixes: Array<{ from: string; to: string }> = [];
  for (const [re, replacement] of TYPO_FIXES) {
    out = out.replace(re, (match) => {
      fixes.push({ from: match, to: replacement });
      return replacement;
    });
  }
  return { normalized: out, fixes };
}

function isValidIsoDate(value: string): boolean {
  // Strict YYYY-MM-DD with valid month/day.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return false;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const date = new Date(`${y}-${mo}-${d}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}

function pushMissing(issues: ValidationIssue[], field: string, value: unknown, label: string) {
  if (value === null || value === undefined || String(value).trim() === "") {
    issues.push({ field, severity: "error", message: `${label} is required.` });
  }
}

export function validateDrawingMetadata(
  meta: DrawingMetadata,
  mode: DrawingMode,
): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Universal required fields.
  pushMissing(issues, "projectName", meta.projectName, "Project name");
  pushMissing(issues, "sheetNumber", meta.sheetNumber, "Sheet number");
  pushMissing(issues, "scale", meta.scale, "Scale");

  // Discipline spelling check (warning if present-but-typo, ignored if blank).
  if (meta.discipline && meta.discipline.trim()) {
    const d = meta.discipline.trim();
    if (KNOWN_TYPOS.has(d.toLowerCase())) {
      issues.push({
        field: "discipline",
        severity: "error",
        message: `Discipline "${d}" is a known typo. Fix the project metadata before exporting.`,
      });
    } else if (!CANONICAL_DISCIPLINES.some((c) => c.toLowerCase() === d.toLowerCase())) {
      issues.push({
        field: "discipline",
        severity: "warning",
        message: `Discipline "${d}" is not a recognized label. Expected one of: ${CANONICAL_DISCIPLINES.join(", ")}.`,
      });
    }
  }

  // Project / client name typo check (hard error so it never reaches an export).
  for (const [field, label, val] of [
    ["projectName", "Project name", meta.projectName],
    ["clientName", "Client name", meta.clientName],
  ] as const) {
    if (val && String(val).trim()) {
      const fix = normalizeProjectName(String(val));
      if (fix.fixes.length > 0) {
        issues.push({
          field,
          severity: "error",
          message: `${label} contains a typo: ${fix.fixes.map((f) => `"${f.from}" → "${f.to}"`).join(", ")}. Fix it before exporting.`,
        });
      }
    }
  }

  // Date format check (any provided date must parse).
  if (meta.issueDate && meta.issueDate.trim()) {
    if (!isValidIsoDate(meta.issueDate)) {
      issues.push({
        field: "issueDate",
        severity: "error",
        message: `Issue date "${meta.issueDate}" is malformed. Use YYYY-MM-DD.`,
      });
    }
  }

  // Mode-specific required fields.
  if (mode === "review_draft") {
    pushMissing(issues, "reviewerName", meta.reviewerName, "Reviewer name");
  }

  if (mode === "issued") {
    pushMissing(issues, "drawnBy", meta.drawnBy, "Drawn by");
    pushMissing(issues, "checkedBy", meta.checkedBy, "Checked by");
    pushMissing(issues, "approvedBy", meta.approvedBy, "Approved by");
    pushMissing(issues, "issueDate", meta.issueDate, "Issue date");
    if ((meta.unresolvedIssueCount ?? 0) > 0) {
      issues.push({
        field: "unresolvedIssueCount",
        severity: "error",
        message: `${meta.unresolvedIssueCount} unresolved validation issue(s) — cannot issue for fabrication.`,
      });
    }
  }

  const ok = issues.every((i) => i.severity !== "error");
  return { ok, issues };
}