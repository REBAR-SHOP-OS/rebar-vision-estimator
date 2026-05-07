/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildEngineerAnswerDraft, summarizeEngineerAnswer } from "./qa-answer-fields";
import type { WorkflowFileRef, WorkflowQaIssue, WorkflowTakeoffRow } from "../takeoff-data";

export type AssistantMessageKind = "progress" | "question" | "suggestion" | "applied_fix" | "error";

export type AssistantMessageMetadata = {
  channel: "workflow_v2_assistant";
  kind: AssistantMessageKind;
  linked_issue_id?: string | null;
  linked_estimate_item_id?: string | null;
  confidence?: "high" | "medium" | "low";
  working_steps?: string[];
  attachments?: Array<{ name: string; type: string; file_path?: string; url?: string }>;
  suggestion?: AssistantSuggestion | null;
};

export type AssistantSuggestion = {
  issueId: string;
  issueTitle: string;
  locationLabel: string;
  linkedEstimateItemId?: string | null;
  linkedTakeoffMark?: string | null;
  question: string;
  answerText: string;
  confidence: "high" | "medium" | "low";
  needsConfirmation: boolean;
  structuredValues: Record<string, string>;
  missingRefs: string[];
  sourceExcerpt?: string | null;
};

export type AssistantProjectSnapshot = {
  files: WorkflowFileRef[];
  takeoffRows: WorkflowTakeoffRow[];
  qaIssues: WorkflowQaIssue[];
};

const REBAR_MASS_KG_PER_M: Record<string, number> = {
  "10M": 0.785,
  "15M": 1.57,
  "20M": 2.355,
  "25M": 3.925,
  "30M": 5.495,
  "35M": 7.85,
};

export function isAssistantConfirmationIntent(text: string): boolean {
  return /\b(yes|confirm|confirmed|apply|save it|mark resolved|resolve|use this|looks good|approved)\b/i.test(text);
}

export function buildWorkingSteps(snapshot: AssistantProjectSnapshot): string[] {
  const blocked = snapshot.takeoffRows.filter((row) => row.geometry_status === "unresolved").length;
  return [
    `Reading ${snapshot.files.length} project file${snapshot.files.length === 1 ? "" : "s"}`,
    `Checking ${snapshot.qaIssues.length} open QA issue${snapshot.qaIssues.length === 1 ? "" : "s"}`,
    `Finding linked takeoff rows (${blocked} unresolved)`,
    "Waiting for estimator confirmation before applying changes",
  ];
}

export function pickAssistantIssue(prompt: string, issues: WorkflowQaIssue[], rows: WorkflowTakeoffRow[]): WorkflowQaIssue | null {
  if (issues.length === 0) return null;
  const text = prompt.toLowerCase();
  const byIssue = issues.find((issue) => {
    const candidates = [
      issue.id,
      issue.location_label,
      issue.title,
      issue.linked_item?.id,
      issue.linked_item?.description,
    ].filter(Boolean).map((value) => String(value).toLowerCase());
    return candidates.some((value) => value.length > 2 && text.includes(value));
  });
  if (byIssue) return byIssue;

  const row = rows.find((candidate) => {
    const candidates = [candidate.mark, candidate.raw_id, candidate.shape, candidate.segment_name]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());
    return candidates.some((value) => value.length > 2 && text.includes(value));
  });
  if (row) {
    const rowId = row.raw_id.toLowerCase();
    const rowMark = row.mark.toLowerCase();
    const linked = issues.find((issue) => {
      const linkedId = String(issue.linked_item?.id || "").toLowerCase();
      const refs = Array.isArray(issue.source_refs) ? issue.source_refs : [];
      return linkedId === rowId
        || issue.title.toLowerCase().includes(rowMark)
        || refs.some((ref: any) => String(ref?.estimate_item_id || "").toLowerCase() === rowId);
    });
    if (linked) return linked;
  }

  return issues.find((issue) => ["critical", "error"].includes(String(issue.severity || "").toLowerCase()))
    || issues[0];
}

export function buildAssistantSuggestion(prompt: string, snapshot: AssistantProjectSnapshot): AssistantSuggestion | null {
  const issue = pickAssistantIssue(prompt, snapshot.qaIssues, snapshot.takeoffRows);
  if (!issue) return null;

  const linkedRow = snapshot.takeoffRows.find((row) => row.raw_id === issue.linked_item?.id)
    || snapshot.takeoffRows.find((row) => issue.title.toLowerCase().includes(row.mark.toLowerCase()));
  const missingRefs = issue.linked_item?.missing_refs || [];
  const draft = buildEngineerAnswerDraft({
    locationLabel: issue.location_label,
    pageNumber: issue.location?.page_number || issue.locator?.page_number || undefined,
    objectIdentity: issue.location?.element_reference || issue.linked_item?.description || null,
    description: issue.description || issue.raw_description || null,
    title: issue.title,
    sourceExcerpt: issue.location?.source_excerpt || issue.locator?.anchor_text || issue.linked_item?.description || null,
    missingRefs,
  });
  const sourceExcerpt = issue.location?.source_excerpt || issue.locator?.anchor_text || issue.linked_item?.description || null;
  const fallbackAnswer = draft.draftAnswer || buildFallbackSuggestedAnswer(issue, missingRefs, sourceExcerpt);

  return {
    issueId: issue.id,
    issueTitle: issue.title,
    locationLabel: issue.location_label || (issue.location?.page_number ? `P${issue.location.page_number}` : "selected issue"),
    linkedEstimateItemId: issue.linked_item?.id || null,
    linkedTakeoffMark: linkedRow?.mark || null,
    question: draft.question,
    answerText: fallbackAnswer,
    confidence: draft.draftAnswer ? draft.confidence : "low",
    needsConfirmation: true,
    structuredValues: draft.structuredValues,
    missingRefs,
    sourceExcerpt,
  };
}

function buildFallbackSuggestedAnswer(issue: WorkflowQaIssue, missingRefs: string[], sourceExcerpt?: string | null): string {
  const object = issue.location?.element_reference || issue.linked_item?.description || "highlighted item";
  const missing = humanMissingRefs(missingRefs);
  const found = sourceExcerpt
    ? `Found source excerpt: "${String(sourceExcerpt).slice(0, 160)}".`
    : `Found the linked ${object} at ${issue.location_label || "the selected drawing location"}.`;
  return `${found} Please confirm ${missing} for ${object}.`;
}

function humanMissingRefs(missingRefs: string[]): string {
  const text = missingRefs.join(" ").toLowerCase();
  const parts: string[] = [];
  if (/length|run|dimension|element_dimensions/.test(text)) parts.push("length");
  if (/width|dimension|element_dimensions/.test(text)) parts.push("width");
  if (/height|wall_height|dimension|element_dimensions/.test(text)) parts.push("height");
  if (/bar|rebar|callout/.test(text)) parts.push("bar callout");
  if (/qty|quantity|count/.test(text)) parts.push("quantity");
  const unique = Array.from(new Set(parts));
  if (unique.length === 0) return "the missing drawing values";
  if (unique.length === 1) return `the ${unique[0]}`;
  return `the ${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

export function parseAssistantAnswerValues(text: string, structuredValues: Record<string, string> = {}) {
  const combined = `${text}\n${Object.entries(structuredValues).map(([k, v]) => `${k}: ${v}`).join("\n")}`;
  const barSize = combined.match(/\b(10M|15M|20M|25M|30M|35M)\b/i)?.[1]?.toUpperCase() || null;
  const explicitQty = combined.match(/\b(?:quantity|qty|count)\s*(?:=|:|is)?\s*(\d+)\b/i)?.[1]
    || combined.match(/\b(\d+)\s*(?:dowels?|bars?)\b/i)?.[1]
    || null;
  const pieceLengthM = extractPieceLengthM(combined);
  const spacingM = extractSpacingM(combined);
  const runLengthM = extractRunLengthM(combined, structuredValues.length);
  const quantity = explicitQty ? Number(explicitQty) : (runLengthM && spacingM ? Math.floor(runLengthM / spacingM) + 1 : null);
  const totalLengthM = quantity && pieceLengthM ? quantity * pieceLengthM : runLengthM;
  const weightKg = totalLengthM && barSize && REBAR_MASS_KG_PER_M[barSize]
    ? Number((totalLengthM * REBAR_MASS_KG_PER_M[barSize]).toFixed(2))
    : null;

  return {
    barSize,
    quantity: quantity && Number.isFinite(quantity) ? quantity : null,
    totalLengthM: totalLengthM && Number.isFinite(totalLengthM) ? Number(totalLengthM.toFixed(3)) : null,
    weightKg,
  };
}

function extractPieceLengthM(text: string): number | null {
  const match = text.match(/\b(\d+(?:\.\d+)?)\s*(mm|m)\s*(?:\([^)]*\)\s*)?(?:long|bar length|dowel)/i);
  if (!match) return null;
  return toMeters(Number(match[1]), match[2]);
}

function extractSpacingM(text: string): number | null {
  const match = text.match(/(?:@|at)\s*(\d+(?:\.\d+)?)\s*(mm|m)\s*(?:\([^)]*\)\s*)?O\.?\s*C\.?/i);
  if (!match) return null;
  return toMeters(Number(match[1]), match[2]);
}

function extractRunLengthM(text: string, structuredLength?: string): number | null {
  if (structuredLength) {
    const plain = structuredLength.match(/^\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(mm|m)\s*$/i);
    if (plain) return toMeters(Number(plain[1].replace(/,/g, "")), plain[2]);
  }
  const source = `${structuredLength || ""}\n${text}`;
  const labeled = source.match(/\b(?:run\s*length|wall\s*length|pad\s*length|slab\s*length|footing\s*length|length)\s*(?:=|:|is)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(mm|m)\b/i);
  if (!labeled) return null;
  return toMeters(Number(labeled[1].replace(/,/g, "")), labeled[2]);
}

function toMeters(value: number, unit: string): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return unit.toLowerCase() === "m" ? value : value / 1000;
}

export async function applyAssistantSuggestion(
  supabase: SupabaseClient<any>,
  suggestion: AssistantSuggestion,
  responseText: string,
  status: "answered" | "review" | "resolved" = "answered",
) {
  const now = new Date().toISOString();
  const values = suggestion.structuredValues || {};
  const text = responseText.trim() || suggestion.answerText;
  const note = text || summarizeEngineerAnswer(values);
  const engineerAnswer = {
    values,
    answer_text: text,
    note,
    status,
    answered_at: now,
    location_label: suggestion.locationLabel,
    issue_id: suggestion.issueId,
    source: "workflow_v2_assistant",
  };

  if (suggestion.issueId.startsWith("legacy:")) {
    const issueId = suggestion.issueId.replace(/^legacy:/, "");
    const { data: issueRow, error: issueReadError } = await supabase
      .from("validation_issues")
      .select("source_refs")
      .eq("id", issueId)
      .maybeSingle();
    if (issueReadError) throw issueReadError;
    const refs = Array.isArray(issueRow?.source_refs) ? issueRow.source_refs : [];
    const nextRefs = refs.filter((ref: any) => !ref?.engineer_answer);
    nextRefs.push({ engineer_answer: engineerAnswer });

    const { error } = await supabase
      .from("validation_issues")
      .update({ status, resolution_note: note, source_refs: nextRefs, updated_at: now })
      .eq("id", issueId);
    if (error) throw error;
  }

  const itemPatch = await buildEstimateItemPatch(supabase, suggestion.linkedEstimateItemId || null, text, values, status, engineerAnswer);
  return {
    issueStatus: status,
    estimateUpdated: itemPatch.updated,
    estimateValues: itemPatch.values,
  };
}

async function buildEstimateItemPatch(
  supabase: SupabaseClient<any>,
  estimateItemId: string | null,
  text: string,
  structuredValues: Record<string, string>,
  status: string,
  engineerAnswer: Record<string, unknown>,
) {
  if (!estimateItemId) return { updated: false, values: {} };
  const { data: item, error: readError } = await supabase
    .from("estimate_items")
    .select("id,assumptions_json,bar_size")
    .eq("id", estimateItemId)
    .maybeSingle();
  if (readError) throw readError;
  if (!item) return { updated: false, values: {} };

  const parsed = parseAssistantAnswerValues(text, structuredValues);
  const hasComputableValue = Boolean(parsed.quantity || parsed.totalLengthM || parsed.weightKg || parsed.barSize);
  const assumptions = (item.assumptions_json && typeof item.assumptions_json === "object" && !Array.isArray(item.assumptions_json))
    ? item.assumptions_json as Record<string, unknown>
    : {};
  const geometryStatus = status === "resolved" && (parsed.quantity || parsed.totalLengthM)
    ? "resolved"
    : hasComputableValue
      ? "partial"
      : String(assumptions.geometry_status || "unresolved");
  const update: Record<string, unknown> = {
    assumptions_json: {
      ...assumptions,
      engineer_answer: engineerAnswer,
      geometry_status: geometryStatus,
      missing_refs: geometryStatus === "resolved" ? [] : assumptions.missing_refs,
      assistant_updated_at: new Date().toISOString(),
    },
  };
  if (parsed.barSize) update.bar_size = parsed.barSize;
  if (parsed.quantity) update.quantity_count = parsed.quantity;
  if (parsed.totalLengthM) update.total_length = parsed.totalLengthM;
  if (parsed.weightKg) update.total_weight = parsed.weightKg;
  if (hasComputableValue) update.status = "review";

  const { error } = await supabase.from("estimate_items").update(update).eq("id", estimateItemId);
  if (error) throw error;
  return { updated: true, values: parsed };
}
