import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

// ── Locked Thresholds ──
const THRESHOLDS = {
  critical_field_min_confidence: 0.82,
  identity_min_sources: 2,
  human_review_flagged_trigger_gt: 3,
  majority_vote_required_matches: 2,
  max_questions_per_job: 3,
  max_questions_per_element: 2,
  minor_diff_normalization: {
    allow_O_vs_0: true,
    allow_I_vs_1: true,
    allow_S_vs_5: true,
    strip_spaces: true,
    strip_commas: true,
  },
};

const ALLOWED_ELEMENT_TYPES = [
  "COLUMN", "WALL", "FOOTING", "BEAM", "SLAB_STRIP",
  "GRADE_BEAM", "RAFT_SLAB", "RETAINING_WALL", "ICF_WALL", "CMU_WALL",
  "PIER", "SLAB", "STAIR", "WIRE_MESH", "OTHER"
];
const VALID_IDENTITY_SOURCES = ["TAG", "SCHEDULE_ROW", "DETAIL"];

// ── Normalization ──
function normalize(value: string): string {
  let v = value.toUpperCase();
  if (THRESHOLDS.minor_diff_normalization.strip_spaces) v = v.replace(/\s/g, "");
  if (THRESHOLDS.minor_diff_normalization.strip_commas) v = v.replace(/,/g, "");
  if (THRESHOLDS.minor_diff_normalization.allow_O_vs_0) v = v.replace(/O/g, "0");
  if (THRESHOLDS.minor_diff_normalization.allow_I_vs_1) v = v.replace(/I/g, "1");
  if (THRESHOLDS.minor_diff_normalization.allow_S_vs_5) v = v.replace(/S/g, "5");
  return v;
}

function isMinorDiff(a: string, b: string): boolean {
  return normalize(String(a)) === normalize(String(b));
}

// ── Field Voting ──
function voteField(votes: any[]): { winner: any; confidence: number; method: string } {
  if (!votes || votes.length === 0) return { winner: null, confidence: 0, method: "none" };

  // Count normalized occurrences
  const counts = new Map<string, { count: number; original: any }>();
  for (const v of votes) {
    const norm = normalize(String(v));
    const existing = counts.get(norm);
    if (existing) {
      existing.count++;
    } else {
      counts.set(norm, { count: 1, original: v });
    }
  }

  // Find majority
  for (const [, entry] of counts) {
    if (entry.count >= THRESHOLDS.majority_vote_required_matches) {
      return { winner: entry.original, confidence: entry.count / votes.length, method: "majority" };
    }
  }

  // All different — check if minor diffs exist
  const allMinor = votes.every((v, _, arr) => isMinorDiff(String(v), String(arr[0])));
  if (allMinor) {
    return { winner: votes[0], confidence: 0.7, method: "minor_diff" };
  }

  // No agreement
  return { winner: votes[0], confidence: 0.33, method: "no_consensus" };
}

// ── Gate Checks ──
interface GateResult {
  passed: boolean;
  details: Record<string, any>;
}

function identityGate(element: any): GateResult {
  const sources = element.extraction?.sources?.identity_sources || [];
  const validSources = sources.filter((s: string) => VALID_IDENTITY_SOURCES.includes(s));
  const passed = validSources.length >= THRESHOLDS.identity_min_sources;
  return { passed, details: { sources_count: validSources.length, sources: validSources, required: THRESHOLDS.identity_min_sources } };
}

function completenessGate(element: any): GateResult {
  const truth = element.extraction?.truth || {};
  const missing: string[] = [];
  const type = element.element_type;

  // Type-specific completeness rules
  const SLAB_TYPES = ["SLAB", "RAFT_SLAB", "SLAB_STRIP"];
  const WALL_TYPES = ["WALL", "RETAINING_WALL", "ICF_WALL", "CMU_WALL"];

  if (SLAB_TYPES.includes(type)) {
    if (!truth.thickness) missing.push("thickness");
    if (!truth.mesh_type && !truth.vertical_bars?.size) missing.push("mesh_type or rebar size");
  } else if (type === "WIRE_MESH") {
    if (!truth.mesh_type) missing.push("mesh_type");
    if (!truth.area_sqft) missing.push("area_sqft");
  } else if (type === "STAIR") {
    if (!truth.vertical_bars?.size) missing.push("vertical_bars.size");
    if (!truth.vertical_bars?.qty) missing.push("vertical_bars.qty");
  } else {
    // Standard rebar elements (COLUMN, WALL, FOOTING, BEAM, PIER, etc.)
    if (!truth.vertical_bars?.size) missing.push("vertical_bars.size");
    if (!truth.vertical_bars?.qty) missing.push("vertical_bars.qty");
    if (!truth.ties?.size) missing.push("ties.size");
    if (!truth.ties?.spacing_mm) missing.push("ties.spacing_mm");
  }

  return { passed: missing.length === 0, details: { missing_fields: missing } };
}

function consistencyGate(element: any): GateResult {
  const sources = element.extraction?.sources || {};
  const conflicts: string[] = [];

  // Compare schedule vs detail on critical fields
  if (sources.schedule && sources.detail) {
    const scheduleFields = sources.schedule;
    const detailFields = sources.detail;
    for (const field of ["size", "qty", "spacing"]) {
      if (scheduleFields[field] && detailFields[field] && !isMinorDiff(String(scheduleFields[field]), String(detailFields[field]))) {
        conflicts.push(`SCHEDULE_ROW vs DETAIL on ${field}: "${scheduleFields[field]}" vs "${detailFields[field]}"`);
      }
    }
  }

  // Compare tag vs schedule
  if (sources.tag && sources.schedule) {
    for (const field of ["size", "qty"]) {
      if (sources.tag[field] && sources.schedule[field] && !isMinorDiff(String(sources.tag[field]), String(sources.schedule[field]))) {
        conflicts.push(`TAG vs SCHEDULE_ROW on ${field}: "${sources.tag[field]}" vs "${sources.schedule[field]}"`);
      }
    }
  }

  return { passed: conflicts.length === 0, details: { conflicts } };
}

function scopeGate(element: any, allowedTypes: string[]): GateResult {
  const type = element.element_type;
  const passed = allowedTypes.includes(type);
  return { passed, details: { element_type: type, allowed: allowedTypes, error: passed ? null : "OUT_OF_SCOPE" } };
}

function unitGate(element: any, globalUnitsContext: string): GateResult {
  const truth = element.extraction?.truth || {};
  const barLines = truth.bar_lines || [];
  const issues: string[] = [];

  if (globalUnitsContext === "UNKNOWN!") {
    issues.push("units_context is UNKNOWN!");
  }

  if (globalUnitsContext !== "MIXED_CONFIRMED") {
    const hasMetric = barLines.some((bl: any) => bl.length_mm && bl.length_mm > 0);
    const hasImperial = barLines.some((bl: any) => bl.length_ft && bl.length_ft > 0);
    if (hasMetric && hasImperial) {
      issues.push("Mixed metric/imperial lengths without MIXED_CONFIRMED");
    }
  }

  return { passed: issues.length === 0, details: { issues, units_context: globalUnitsContext } };
}

// ── G6: Coating Gate (advisory — never blocks, always warns) ──
const SPECIAL_COATINGS = ["EPOXY", "STAINLESS", "GALVANISED", "MMFX", "HIGH_STRENGTH", "COATED_OTHER"];
const COATING_LABELS: Record<string, string> = {
  EPOXY: "Epoxy-Coated (~20% price premium)",
  STAINLESS: "Stainless Steel (~5-8× price premium)",
  GALVANISED: "Galvanized (~35% price premium)",
  MMFX: "MMFX/High-Strength (verify pricing)",
  HIGH_STRENGTH: "High-Strength (verify pricing)",
  COATED_OTHER: "Special Coating (verify pricing)",
};

function coatingGate(element: any): { coating: string | null; warning: string | null } {
  const coating = element.extraction?.truth?.coating;
  if (!coating || coating === "none" || coating === "BLACK") return { coating: null, warning: null };
  if (SPECIAL_COATINGS.includes(coating)) {
    return { coating, warning: `Special coating detected: ${coating} — ${COATING_LABELS[coating] || "verify pricing applies"}` };
  }
  return { coating, warning: `Non-standard coating detected: ${coating} — verify pricing applies` };
}

// ── Question Generation ──
interface Question {
  element_id: string;
  field: string;
  issue: "CONFLICT" | "LOW_CONFIDENCE" | "MISSING";
  prompt: string;
  options: string[];
  severity: "LOW" | "MED" | "HIGH" | "BLOCKING";
}

function generateQuestions(element: any, consistency: GateResult, jobQuestionCount: number): Question[] {
  const questions: Question[] = [];
  if (element.status !== "FLAGGED") return questions;

  const maxForElement = THRESHOLDS.max_questions_per_element;
  const remainingForJob = THRESHOLDS.max_questions_per_job - jobQuestionCount;
  const maxQuestions = Math.min(maxForElement, remainingForJob);
  if (maxQuestions <= 0) return questions;

  // Priority order: tie spacing > vertical qty > bar size > other
  const fieldPriority = ["ties.spacing_mm", "vertical_bars.qty", "vertical_bars.size", "ties.size"];

  // Consistency conflicts
  const conflicts = consistency.details.conflicts || [];
  for (const conflict of conflicts) {
    if (questions.length >= maxQuestions) break;
    // Extract field name from conflict string
    const fieldMatch = conflict.match(/on (\w+):/);
    const field = fieldMatch ? fieldMatch[1] : "unknown";
    const valuesMatch = conflict.match(/"([^"]+)" vs "([^"]+)"/);
    const options = valuesMatch ? [valuesMatch[1], valuesMatch[2], "Other (specify in chat)"] : ["Option A", "Option B", "Other"];

    questions.push({
      element_id: element.element_id,
      field,
      issue: "CONFLICT",
      prompt: `Conflict detected for ${element.element_id}: ${conflict}. Which value is correct?`,
      options,
      severity: fieldPriority.indexOf(field) <= 1 ? "HIGH" : "MED",
    });
  }

  // Low confidence fields
  const fieldVotes = element.extraction?.field_votes || {};
  for (const field of fieldPriority) {
    if (questions.length >= maxQuestions) break;
    const vote = fieldVotes[field];
    if (vote && vote.confidence !== undefined && vote.confidence < THRESHOLDS.critical_field_min_confidence) {
      questions.push({
        element_id: element.element_id,
        field,
        issue: "LOW_CONFIDENCE",
        prompt: `Low confidence (${(vote.confidence * 100).toFixed(0)}%) for ${element.element_id} ${field}. Current value: "${vote.winner}". Is this correct?`,
        options: [String(vote.winner), "Other (specify in chat)"],
        severity: "MED",
      });
    }
  }

  // Missing fields
  const truth = element.extraction?.truth || {};
  const missingChecks = [
    { field: "ties.spacing_mm", value: truth.ties?.spacing_mm },
    { field: "vertical_bars.qty", value: truth.vertical_bars?.qty },
    { field: "vertical_bars.size", value: truth.vertical_bars?.size },
    { field: "ties.size", value: truth.ties?.size },
  ];
  for (const check of missingChecks) {
    if (questions.length >= maxQuestions) break;
    if (!check.value) {
      questions.push({
        element_id: element.element_id,
        field: check.field,
        issue: "MISSING",
        prompt: `Missing value for ${element.element_id} ${check.field}. Please provide.`,
        options: ["Specify in chat"],
        severity: "BLOCKING",
      });
    }
  }

  return questions;
}

// ── Main Handler ──
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }

  try {
    const { elements, allowedTypes, userAnswers, units_context } = await req.json();
    const globalUnitsContext = units_context || "UNKNOWN!";

    if (!elements || !Array.isArray(elements)) {
      return new Response(JSON.stringify({ error: "elements array is required" }), {
        status: 400,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const scopeTypes = allowedTypes && Array.isArray(allowedTypes) ? allowedTypes : ALLOWED_ELEMENT_TYPES;

    // Apply user answers if provided (re-validation after user input)
    if (userAnswers && Array.isArray(userAnswers)) {
      for (const answer of userAnswers) {
        const el = elements.find((e: any) => e.element_id === answer.element_id);
        if (el && el.extraction?.truth) {
          // Update the truth field with user's answer
          const parts = answer.field.split(".");
          if (parts.length === 2) {
            if (!el.extraction.truth[parts[0]]) el.extraction.truth[parts[0]] = {};
            el.extraction.truth[parts[0]][parts[1]] = answer.value;
          } else {
            el.extraction.truth[answer.field] = answer.value;
          }
        }
      }
    }

    let jobQuestionCount = 0;
    const validatedElements: any[] = [];

    for (const element of elements) {
      // Run 6 gates (G1-G6)
      const identity = identityGate(element);
      const completeness = completenessGate(element);
      const scope = scopeGate(element, scopeTypes);
      const consistency = consistencyGate(element);
      const unit = unitGate(element, globalUnitsContext);
      const coating = coatingGate(element);

      // Determine status
      let status: "READY" | "FLAGGED" | "BLOCKED";
      const errors: string[] = [];
      const warnings: string[] = [];

      if (!identity.passed) {
        status = "BLOCKED";
        errors.push(`Identity gate failed: only ${identity.details.sources_count} source(s), need ${THRESHOLDS.identity_min_sources}`);
      } else if (!completeness.passed) {
        status = "BLOCKED";
        errors.push(`Completeness gate failed: missing ${identity.details.missing_fields?.join(", ") || completeness.details.missing_fields?.join(", ")}`);
      } else if (!scope.passed) {
        status = "BLOCKED";
        errors.push(`Scope gate failed: ${scope.details.error}`);
      } else if (!unit.passed) {
        status = "BLOCKED";
        errors.push(`Unit gate failed: ${unit.details.issues?.join("; ")}`);
      } else if (!consistency.passed) {
        status = "FLAGGED";
        warnings.push(...(consistency.details.conflicts || []));
      } else {
        // Check confidence on critical fields
        const fieldVotes = element.extraction?.field_votes || {};
        let lowConfidence = false;
        for (const field of ["vertical_bars.size", "vertical_bars.qty", "ties.size", "ties.spacing_mm"]) {
          const vote = fieldVotes[field];
          if (vote && vote.confidence !== undefined && vote.confidence < THRESHOLDS.critical_field_min_confidence) {
            lowConfidence = true;
            warnings.push(`Low confidence on ${field}: ${(vote.confidence * 100).toFixed(0)}%`);
          }
        }
        status = lowConfidence ? "FLAGGED" : "READY";
      }

      // G6: Coating advisory warning (never blocks/flags, just warns)
      if (coating.warning) {
        warnings.push(coating.warning);
      }

      // Generate questions for FLAGGED
      const questions = generateQuestions({ ...element, status }, consistency, jobQuestionCount);
      jobQuestionCount += questions.length;

      const validation = {
        identity,
        completeness,
        consistency,
        scope,
        unit,
        errors,
        warnings,
      };

      validatedElements.push({
        ...element,
        validation,
        status,
        questions,
        updated_at: new Date().toISOString(),
      });
    }

    const readyCount = validatedElements.filter((e) => e.status === "READY").length;
    const flaggedCount = validatedElements.filter((e) => e.status === "FLAGGED").length;
    const blockedCount = validatedElements.filter((e) => e.status === "BLOCKED").length;

    const jobStatus = flaggedCount > THRESHOLDS.human_review_flagged_trigger_gt ? "HUMAN_REVIEW_REQUIRED" : "OK";

    const allQuestions = validatedElements.flatMap((e) => e.questions || []);

    const result = {
      elements: validatedElements,
      summary: {
        total_elements: validatedElements.length,
        ready_count: readyCount,
        flagged_count: flaggedCount,
        blocked_count: blockedCount,
        job_status: jobStatus,
        total_questions: allQuestions.length,
      },
      questions: allQuestions,
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("validate-elements error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
