/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildEngineerAnswerDraft, summarizeEngineerAnswer } from "./qa-answer-fields";
import { buildEstimationAudit, type ExtractionAuditResult } from "../accuracy-audit";
import type { WorkflowFileRef, WorkflowQaIssue, WorkflowTakeoffRow } from "../takeoff-data";
import {
  estimateCanadianLine,
  parseFirstMetricLengthMm,
  parsePieceLengthMm,
  parseSpacingMm,
} from "@/lib/canadian-rebar-estimating";

export type AssistantMessageKind = "progress" | "question" | "suggestion" | "applied_fix" | "audit" | "error";

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

export type EngineerAnswerRecord = {
  values: Record<string, string>;
  answer_text: string;
  note: string;
  status: string;
  answered_at: string;
  location_label?: string | null;
  issue_id?: string | null;
  source?: string;
};

export type ApplyEngineerAnswerResult = {
  updated: boolean;
  values: ReturnType<typeof parseAssistantAnswerValues>;
  geometryStatus: "resolved" | "partial" | "unresolved";
  missingRefs: unknown;
};

export type AssistantProjectSnapshot = {
  files: WorkflowFileRef[];
  takeoffRows: WorkflowTakeoffRow[];
  qaIssues: WorkflowQaIssue[];
  extractionAudit?: ExtractionAuditResult | null;
  estimatorConfirmed?: boolean;
};

export type FinishEstimationAgentResult = {
  content: string;
  suggestion: AssistantSuggestion | null;
  confidence: "high" | "medium" | "low";
  workingSteps: string[];
};

export function isAssistantConfirmationIntent(text: string): boolean {
  return /\b(yes|confirm|confirmed|apply|save it|mark resolved|resolve|use this|looks good|approved)\b/i.test(text);
}

export function isFinishAuditIntent(text: string): boolean {
  return /(?:\b(?:finish|final|complete|audit|check all|full check|estimator confirmed|ready for output|ready to confirm)\b|100\s*%)/i.test(text)
    && /\b(estimate|estimation|takeoff|project|qa|output|confidence|confirmed|audit)\b/i.test(text);
}

const CLOSED_ASSISTANT_ISSUE_STATUSES = new Set(["answered", "resolved", "closed"]);

function normalizeSignatureText(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9@./"() -]/g, "")
    .trim();
}

function sourceRefsArray(sourceRefs: unknown): any[] {
  if (Array.isArray(sourceRefs)) return sourceRefs;
  if (sourceRefs && typeof sourceRefs === "object") return [sourceRefs];
  return [];
}

function latestEngineerAnswerStatus(issue: WorkflowQaIssue): string | null {
  const refs = sourceRefsArray(issue.source_refs);
  for (const ref of [...refs].reverse()) {
    const status = ref?.engineer_answer?.status;
    if (status) return String(status).toLowerCase();
  }
  return null;
}

function isAssistantOpenIssue(issue: WorkflowQaIssue): boolean {
  const status = String(issue.status || "").toLowerCase();
  if (CLOSED_ASSISTANT_ISSUE_STATUSES.has(status)) return false;
  const engineerStatus = latestEngineerAnswerStatus(issue);
  if (engineerStatus && CLOSED_ASSISTANT_ISSUE_STATUSES.has(engineerStatus)) return false;
  return true;
}

function issueDisplaySignature(issue: WorkflowQaIssue): string {
  const firstRef = sourceRefsArray(issue.source_refs)[0] || null;
  const draft = buildEngineerAnswerDraft({
    locationLabel: issue.location_label,
    pageNumber: issue.location?.page_number || issue.locator?.page_number || undefined,
    objectIdentity: issue.location?.element_reference || issue.linked_item?.description || null,
    description: issue.description || issue.raw_description || null,
    title: issue.title,
    sourceExcerpt: issue.location?.source_excerpt || issue.locator?.anchor_text || issue.linked_item?.description || null,
    missingRefs: issue.linked_item?.missing_refs || [],
    linearGeometry: firstRef?.linear_geometry || null,
    wallGeometry: firstRef?.wall_geometry || null,
  });
  return normalizeSignatureText([
    issue.location_label,
    issue.location?.element_reference || issue.linked_item?.description || issue.title,
    draft.draftAnswer || issue.location?.source_excerpt || issue.description || issue.raw_description,
  ].join("|"));
}

function getAssistantOpenIssues(issues: WorkflowQaIssue[]): WorkflowQaIssue[] {
  const seen = new Set<string>();
  const open: WorkflowQaIssue[] = [];
  for (const issue of issues) {
    if (!isAssistantOpenIssue(issue)) continue;
    const signature = issueDisplaySignature(issue);
    if (seen.has(signature)) continue;
    seen.add(signature);
    open.push(issue);
  }
  return open;
}

function rowNeedsAnswer(row: WorkflowTakeoffRow): boolean {
  return row.geometry_status !== "resolved" || row.count <= 0 || row.length <= 0 || row.weight <= 0;
}

function rowDisplaySignature(row: WorkflowTakeoffRow): string {
  return normalizeSignatureText([
    row.segment_name,
    row.size,
    row.shape,
    row.source_file_id || "",
    row.page_number || "",
  ].join("|"));
}

function getBlockedTakeoffRows(rows: WorkflowTakeoffRow[]): Array<{ row: WorkflowTakeoffRow; duplicateMarks: string[] }> {
  const bySignature = new Map<string, { row: WorkflowTakeoffRow; duplicateMarks: string[] }>();
  for (const row of rows) {
    if (!rowNeedsAnswer(row)) continue;
    const signature = rowDisplaySignature(row);
    const existing = bySignature.get(signature);
    if (existing) {
      existing.duplicateMarks.push(row.mark);
    } else {
      bySignature.set(signature, { row, duplicateMarks: [] });
    }
  }
  return Array.from(bySignature.values());
}

function normalizeAssistantAuditSnapshot(snapshot: AssistantProjectSnapshot): AssistantProjectSnapshot {
  return {
    ...snapshot,
    qaIssues: getAssistantOpenIssues(snapshot.qaIssues),
  };
}

export function buildWorkingSteps(snapshot: AssistantProjectSnapshot): string[] {
  const openIssues = getAssistantOpenIssues(snapshot.qaIssues);
  const blocked = getBlockedTakeoffRows(snapshot.takeoffRows).length;
  return [
    `Reading ${snapshot.files.length} project file${snapshot.files.length === 1 ? "" : "s"}`,
    snapshot.extractionAudit
      ? `Reviewing OCR audit (${snapshot.extractionAudit.indexedPages}/${snapshot.extractionAudit.pageCount || snapshot.extractionAudit.indexedPages} pages indexed)`
      : "Checking OCR audit metadata",
    `Checking ${openIssues.length} open QA issue${openIssues.length === 1 ? "" : "s"}`,
    `Finding linked takeoff rows (${blocked} unresolved)`,
    "Waiting for estimator confirmation before applying changes",
  ];
}

export function buildFinishAuditResponse(snapshot: AssistantProjectSnapshot): string {
  const auditSnapshot = normalizeAssistantAuditSnapshot(snapshot);
  const audit = buildEstimationAudit({
    files: auditSnapshot.files,
    rows: auditSnapshot.takeoffRows,
    issues: auditSnapshot.qaIssues,
    extraction: auditSnapshot.extractionAudit,
    estimatorConfirmed: auditSnapshot.estimatorConfirmed,
  });
  const title = audit.status === "audit_complete"
    ? "Audit Complete - Estimator Confirmation Ready"
    : audit.status === "needs_ocr_review"
      ? "Needs OCR Review Before Final Estimate"
      : "Needs Answers Before Final Estimate";
  const checklist = audit.checklist
    .map((item) => `${item.ok ? "[x]" : "[ ]"} ${item.label}: ${item.detail}`)
    .join("\n");
  const nextQuestion = buildNextAuditQuestion(auditSnapshot, audit.blockers);

  return [
    `**${title}**`,
    "",
    checklist,
    "",
    audit.blockers.length > 0 ? "**Blockers**" : "**Result**",
    audit.blockers.length > 0 ? audit.blockers.map((blocker) => `- ${blocker}`).join("\n") : "- All required checks are clean. Final estimator confirmation is still the truth gate before outputs.",
    "",
    "**Evidence quality**",
    snapshot.extractionAudit
      ? `OCR/index audit is ${snapshot.extractionAudit.status} with score ${Math.round(snapshot.extractionAudit.score * 100)}%. Flags: ${snapshot.extractionAudit.flags.join(", ") || "none"}.`
      : "No extraction audit metadata was loaded for this project yet.",
    "",
    nextQuestion ? `**Next question:** ${nextQuestion}` : "**Next step:** Confirm the estimate, then unlock outputs.",
  ].join("\n");
}

export function buildFinishEstimationAgentResponse(snapshot: AssistantProjectSnapshot): FinishEstimationAgentResult {
  const auditSnapshot = normalizeAssistantAuditSnapshot(snapshot);
  const workingSteps = buildWorkingSteps(auditSnapshot);
  const auditText = buildFinishAuditResponse(auditSnapshot);
  const nextSuggestion = buildBestEstimatorSuggestion(auditSnapshot);
  const blockedRows = getBlockedTakeoffRows(auditSnapshot.takeoffRows).slice(0, 8);
  const rowFindings = blockedRows.length
    ? blockedRows.map(({ row, duplicateMarks }) => {
      const suffix = duplicateMarks.length ? ` (${duplicateMarks.join(", ")} duplicate${duplicateMarks.length === 1 ? "" : "s"})` : "";
      return `- ${row.mark}${suffix}: ${describeTakeoffRowFinding(row)}`;
    }).join("\n")
    : "- No blocked takeoff rows found.";
  const openQa = auditSnapshot.qaIssues
    .slice(0, 6)
    .map((issue) => `- ${issue.location_label || issue.title}: ${buildIssueFinding(issue)}`)
    .join("\n");
  const nextBlock = nextSuggestion
    ? [
      "**Next suggested answer**",
      nextSuggestion.answerText,
      "",
      `**Next question:** ${nextSuggestion.question}`,
      `Evidence quality: ${nextSuggestion.confidence}`,
      "Say **apply** to save this answer, or correct the answer in chat.",
    ].join("\n")
    : "**Next suggested answer**\nNo open QA answer is ready to apply. Re-run OCR/takeoff for stale or missing evidence, then ask me to audit again.";

  return {
    content: [
      auditText,
      "",
      "**Blocked Row Findings**",
      rowFindings,
      "",
      openQa ? "**Open QA Findings**\n" + openQa : "**Open QA Findings**\n- No open QA issues found.",
      "",
      nextBlock,
    ].join("\n"),
    suggestion: nextSuggestion,
    confidence: nextSuggestion?.confidence || (blockedRows.length ? "medium" : "high"),
    workingSteps: [
      ...workingSteps,
      "Building row-by-row evidence findings",
      nextSuggestion ? "Prepared the next applyable QA answer" : "No applyable QA answer found",
    ],
  };
}

export function buildNextEstimationAgentResponse(
  snapshot: AssistantProjectSnapshot,
  options: { skipIssueIds?: string[] } = {},
): FinishEstimationAgentResult {
  const skip = new Set((options.skipIssueIds || []).map((id) => String(id)));
  const skippedIssues = snapshot.qaIssues.filter((issue) => skip.has(issue.id));
  const skippedSignatures = new Set(skippedIssues.map((issue) => issueDisplaySignature(issue)));
  return buildFinishEstimationAgentResponse({
    ...snapshot,
    qaIssues: snapshot.qaIssues.filter((issue) => !skip.has(issue.id) && !skippedSignatures.has(issueDisplaySignature(issue))),
  });
}

function buildNextAuditQuestion(snapshot: AssistantProjectSnapshot, blockers: string[]): string | null {
  const unresolvedRow = getBlockedTakeoffRows(snapshot.takeoffRows)[0]?.row || null;
  if (unresolvedRow) {
    const missing = unresolvedRow.missing_refs?.length ? unresolvedRow.missing_refs.join(", ") : "quantity/length basis";
    return `I found row ${unresolvedRow.mark} (${unresolvedRow.shape}) but ${missing} is still missing. What confirmed length, quantity, or drawing basis should I use?`;
  }
  const openIssue = getAssistantOpenIssues(snapshot.qaIssues)[0] || null;
  if (openIssue) {
    return `Issue ${openIssue.location_label || openIssue.title} is still open. Should I save the found answer, mark it for review, or resolve it?`;
  }
  if (blockers.some((blocker) => blocker.includes("OCR complete"))) {
    return "OCR audit is not clean. Should I re-run high-DPI OCR for the flagged pages before final confirmation?";
  }
  if (!snapshot.estimatorConfirmed) return "Everything else looks clean. Do you want to mark this estimate as estimator-confirmed?";
  return null;
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
  const issue = pickAssistantIssue(prompt, getAssistantOpenIssues(snapshot.qaIssues), snapshot.takeoffRows);
  if (!issue) return null;

  const linkedRow = snapshot.takeoffRows.find((row) => row.raw_id === issue.linked_item?.id)
    || snapshot.takeoffRows.find((row) => issue.title.toLowerCase().includes(row.mark.toLowerCase()));
  const missingRefs = issue.linked_item?.missing_refs || [];
  const firstRef = Array.isArray(issue.source_refs) ? issue.source_refs[0] : null;
  const draft = buildEngineerAnswerDraft({
    locationLabel: issue.location_label,
    pageNumber: issue.location?.page_number || issue.locator?.page_number || undefined,
    objectIdentity: issue.location?.element_reference || issue.linked_item?.description || null,
    description: issue.description || issue.raw_description || null,
    title: issue.title,
    sourceExcerpt: issue.location?.source_excerpt || issue.locator?.anchor_text || issue.linked_item?.description || null,
    missingRefs,
    linearGeometry: firstRef?.linear_geometry || null,
    wallGeometry: firstRef?.wall_geometry || null,
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

function buildBestEstimatorSuggestion(snapshot: AssistantProjectSnapshot): AssistantSuggestion | null {
  const openIssues = getAssistantOpenIssues(snapshot.qaIssues);
  if (openIssues.length === 0) return null;
  const scored = openIssues
    .map((issue) => {
      const suggestion = buildSuggestionForIssue(issue, snapshot);
      if (!suggestion) return null;
      const linkedRow = snapshot.takeoffRows.find((row) => row.raw_id === issue.linked_item?.id);
      const confidenceScore = suggestion.confidence === "high" ? 3 : suggestion.confidence === "medium" ? 2 : 1;
      const blockedScore = linkedRow && (linkedRow.geometry_status === "unresolved" || linkedRow.count <= 0 || linkedRow.length <= 0 || linkedRow.weight <= 0) ? 2 : 0;
      const answerScore = suggestion.answerText.toLowerCase().startsWith("found:") || suggestion.answerText.toLowerCase().startsWith("brick ledge") ? 1 : 0;
      return { suggestion, score: confidenceScore + blockedScore + answerScore };
    })
    .filter((entry): entry is { suggestion: AssistantSuggestion; score: number } => !!entry)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.suggestion || null;
}

function buildSuggestionForIssue(issue: WorkflowQaIssue, snapshot: AssistantProjectSnapshot): AssistantSuggestion | null {
  const linkedRow = snapshot.takeoffRows.find((row) => row.raw_id === issue.linked_item?.id)
    || snapshot.takeoffRows.find((row) => issue.title.toLowerCase().includes(row.mark.toLowerCase()));
  const missingRefs = issue.linked_item?.missing_refs || [];
  const firstRef = Array.isArray(issue.source_refs) ? issue.source_refs[0] : null;
  const draft = buildEngineerAnswerDraft({
    locationLabel: issue.location_label,
    pageNumber: issue.location?.page_number || issue.locator?.page_number || undefined,
    objectIdentity: issue.location?.element_reference || issue.linked_item?.description || null,
    description: issue.description || issue.raw_description || null,
    title: issue.title,
    sourceExcerpt: issue.location?.source_excerpt || issue.locator?.anchor_text || issue.linked_item?.description || null,
    missingRefs,
    linearGeometry: firstRef?.linear_geometry || null,
    wallGeometry: firstRef?.wall_geometry || null,
  });
  const sourceExcerpt = issue.location?.source_excerpt || issue.locator?.anchor_text || issue.linked_item?.description || null;
  return {
    issueId: issue.id,
    issueTitle: issue.title,
    locationLabel: issue.location_label || (issue.location?.page_number ? `P${issue.location.page_number}` : "selected issue"),
    linkedEstimateItemId: issue.linked_item?.id || null,
    linkedTakeoffMark: linkedRow?.mark || null,
    question: draft.question,
    answerText: draft.draftAnswer || buildFallbackSuggestedAnswer(issue, missingRefs, sourceExcerpt),
    confidence: draft.draftAnswer ? draft.confidence : "low",
    needsConfirmation: true,
    structuredValues: draft.structuredValues,
    missingRefs,
    sourceExcerpt,
  };
}

function describeTakeoffRowFinding(row: WorkflowTakeoffRow): string {
  const found: string[] = [];
  if (row.size && row.size !== "-") found.push(`bar ${row.size}`);
  if (row.shape) found.push(`callout "${row.shape}"`);
  if (row.count > 0) found.push(`qty ${row.count}`);
  if (row.length > 0) found.push(`length ${row.length}m`);
  if (row.weight > 0) found.push(`weight ${row.weight}kg`);
  const missing: string[] = [];
  if (row.count <= 0) missing.push("qty");
  if (row.length <= 0) missing.push("length");
  if (row.weight <= 0) missing.push("weight");
  if (row.missing_refs?.length) missing.push(...row.missing_refs);
  return `${found.length ? `Found ${found.join(", ")}` : "Found row but no computed quantity values yet"}. ${missing.length ? `Needs ${Array.from(new Set(missing)).join(", ")}.` : "Ready for review."}`;
}

function buildIssueFinding(issue: WorkflowQaIssue): string {
  const firstRef = Array.isArray(issue.source_refs) ? issue.source_refs[0] : null;
  const draft = buildEngineerAnswerDraft({
    locationLabel: issue.location_label,
    pageNumber: issue.location?.page_number || issue.locator?.page_number || undefined,
    objectIdentity: issue.location?.element_reference || issue.linked_item?.description || null,
    description: issue.description || issue.raw_description || null,
    title: issue.title,
    sourceExcerpt: issue.location?.source_excerpt || issue.locator?.anchor_text || issue.linked_item?.description || null,
    missingRefs: issue.linked_item?.missing_refs || [],
    linearGeometry: firstRef?.linear_geometry || null,
    wallGeometry: firstRef?.wall_geometry || null,
  });
  return `${draft.draftAnswer || issue.description || "Needs review"} Evidence quality: ${draft.confidence}.`;
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
  const pieceLengthMm = parsePieceLengthMm(combined);
  const spacingMm = parseSpacingMm(combined);
  const runLengthMm = extractRunLengthMm(combined, structuredValues.length);
  const wallHeightMm = parseFirstMetricLengthMm(combined, ["wall height", "height"]);
  const isHorizontalWall = /\b(horizontal|horiz|hef|top|bottom)\b/i.test(combined);
  const countDistanceMm = isHorizontalWall && wallHeightMm ? wallHeightMm : runLengthMm;
  const calculatedPieceLengthMm = pieceLengthMm || (isHorizontalWall ? runLengthMm : wallHeightMm);
  const estimate = estimateCanadianLine({
    barSize,
    runLengthMm: countDistanceMm,
    spacingMm,
    pieceLengthMm: calculatedPieceLengthMm,
    quantity: explicitQty ? Number(explicitQty) : null,
  });

  return {
    barSize: estimate.barSize || barSize,
    quantity: estimate.quantity,
    totalLengthM: estimate.totalLengthM,
    weightKg: estimate.weightKg,
    rule: estimate.rule,
  };
}

export function linkedEstimateItemIdFromRefs(sourceRefs: unknown): string | null {
  const refs = Array.isArray(sourceRefs) ? sourceRefs : [];
  for (const ref of refs as any[]) {
    const id = ref?.estimate_item_id || ref?.linked_estimate_item_id;
    if (id) return String(id);
  }
  return null;
}

function extractRunLengthMm(text: string, structuredLength?: string): number | null {
  if (structuredLength) {
    const plain = structuredLength.match(/^\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(mm|m)\s*$/i);
    if (plain) return plain[2].toLowerCase() === "m"
      ? Number(plain[1].replace(/,/g, "")) * 1000
      : Number(plain[1].replace(/,/g, ""));
  }
  const source = `${structuredLength || ""}\n${text}`;
  return parseFirstMetricLengthMm(source, ["run length", "wall length", "pad length", "slab length", "footing length", "length"]);
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
  const engineerAnswer: EngineerAnswerRecord = {
    values,
    answer_text: text,
    note,
    status,
    answered_at: now,
    location_label: suggestion.locationLabel,
    issue_id: suggestion.issueId,
    source: "workflow_v2_assistant",
  };

  const itemPatch = await applyEngineerAnswerToEstimateItem(supabase, {
    estimateItemId: suggestion.linkedEstimateItemId || null,
    responseText: text,
    structuredValues: values,
    requestedStatus: status,
    engineerAnswer,
  });
  const effectiveStatus = status === "resolved" && itemPatch.updated && itemPatch.geometryStatus !== "resolved"
    ? "answered"
    : status;
  const effectiveNote = status === "resolved" && itemPatch.updated && itemPatch.geometryStatus !== "resolved"
    ? `${note}\n\nTakeoff update is ${itemPatch.geometryStatus}; quantity, length, and weight are not all proven yet. Confirm the remaining dimensions before resolving.`
    : note;
  engineerAnswer.status = effectiveStatus;
  engineerAnswer.note = effectiveNote;

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
      .update({ status: effectiveStatus, resolution_note: effectiveNote, source_refs: nextRefs, updated_at: now })
      .eq("id", issueId);
    if (error) throw error;
  }

  return {
    issueStatus: effectiveStatus,
    estimateUpdated: itemPatch.updated,
    estimateValues: itemPatch.values,
  };
}

export async function applyEngineerAnswerToEstimateItem(
  supabase: SupabaseClient<any>,
  params: {
    estimateItemId: string | null;
    responseText: string;
    structuredValues?: Record<string, string>;
    requestedStatus: string;
    engineerAnswer: EngineerAnswerRecord;
  },
): Promise<ApplyEngineerAnswerResult> {
  const { estimateItemId, responseText, requestedStatus, engineerAnswer } = params;
  const structuredValues = params.structuredValues || {};
  if (!estimateItemId) {
    return {
      updated: false,
      values: parseAssistantAnswerValues(responseText, structuredValues),
      geometryStatus: "unresolved",
      missingRefs: [],
    };
  }
  const { data: item, error: readError } = await supabase
    .from("estimate_items")
    .select("id,assumptions_json,bar_size")
    .eq("id", estimateItemId)
    .maybeSingle();
  if (readError) throw readError;
  if (!item) {
    return {
      updated: false,
      values: parseAssistantAnswerValues(responseText, structuredValues),
      geometryStatus: "unresolved",
      missingRefs: [],
    };
  }

  const parsed = parseAssistantAnswerValues(responseText, structuredValues);
  const hasComputableValue = Boolean(parsed.quantity || parsed.totalLengthM || parsed.weightKg || parsed.barSize);
  const assumptions = (item.assumptions_json && typeof item.assumptions_json === "object" && !Array.isArray(item.assumptions_json))
    ? item.assumptions_json as Record<string, unknown>
    : {};
  const previousGeometry = String(assumptions.geometry_status || "unresolved");
  const normalizedPrevious = previousGeometry === "resolved" || previousGeometry === "partial" ? previousGeometry : "unresolved";
  const geometryStatus: ApplyEngineerAnswerResult["geometryStatus"] = requestedStatus === "resolved" && parsed.quantity && parsed.totalLengthM && parsed.weightKg
    ? "resolved"
    : hasComputableValue
      ? "partial"
      : normalizedPrevious;
  const storedEngineerAnswer = {
    ...engineerAnswer,
    status: requestedStatus === "resolved" && geometryStatus !== "resolved" ? "answered" : engineerAnswer.status,
  };
  const update: Record<string, unknown> = {
    assumptions_json: {
      ...assumptions,
      engineer_answer: storedEngineerAnswer,
      geometry_status: geometryStatus,
      missing_refs: geometryStatus === "resolved" ? [] : assumptions.missing_refs,
      answer_derivation: parsed.rule || assumptions.answer_derivation || null,
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
  return {
    updated: true,
    values: parsed,
    geometryStatus,
    missingRefs: (update.assumptions_json as Record<string, unknown>).missing_refs,
  };
}
