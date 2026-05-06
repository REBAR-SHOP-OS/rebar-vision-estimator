/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from "@/integrations/supabase/client";
import { getRebarProjectIdByLegacyId } from "@/lib/rebar-read-model";

export interface WorkflowFileRef {
  id: string;
  legacy_file_id?: string | null;
  file_name: string;
}

export interface WorkflowTakeoffRow {
  id: string;
  mark: string;
  size: string;
  shape: string;
  count: number;
  length: number;
  weight: number;
  status: "ready" | "review" | "blocked";
  source: string;
  // Newly added — minimal fields for segment grouping, blueprint preview & inline OCR edit
  segment_id: string | null;
  segment_name: string;
  source_file_id: string | null;
  raw_id: string;        // raw DB id (without legacy:/canonical: prefix)
  raw_kind: "legacy" | "canonical";
  // Geometry resolver state set by auto-estimate. UI must render UNRESOLVED
  // rows as "—" not 0.
  geometry_status: "resolved" | "partial" | "unresolved";
  missing_refs: string[];
  page_number?: number | null;
}

export interface WorkflowQaIssue {
  id: string;
  title: string;
  description?: string | null;
  severity: string;
  status: string;
  sheet_id?: string | null;
  issue_type: string;
  source_file_id?: string | null;
  source_refs?: any;
  // Pinpoint locator + linked-row preview (filled by loader)
  locator?: {
    page_number?: number | null;
    bbox?: [number, number, number, number] | null;
    image_size?: { w: number; h: number } | null;
    anchor_confidence?: number | null;
    anchor_mode?: "exact" | "approximate" | "unavailable" | null;
  } | null;
  linked_item?: { id: string; description: string | null; bar_size: string | null; quantity_count: number; total_length: number; total_weight: number; missing_refs: string[]; source_file_id?: string | null; segment_id?: string | null; page_number?: number | null } | null;
  // Structured drawing location (used to prefix question text)
  location?: {
    source_sheet?: string | null;
    page_number?: number | null;
    detail_reference?: string | null;
    grid_reference?: string | null;
    zone_reference?: string | null;
    element_reference?: string | null;
    source_excerpt?: string | null;
  } | null;
  location_label?: string | null;
  raw_description?: string | null;
}

const CLOSED_STATUSES = new Set(["resolved", "closed"]);

const REBAR_MASS_KG_PER_M: Record<string, number> = {
  "10M": 0.785, "15M": 1.570, "20M": 2.355, "25M": 3.925, "30M": 5.495, "35M": 7.850,
  "#3": 0.561, "#4": 0.994, "#5": 1.552, "#6": 2.235, "#7": 3.042, "#8": 3.973,
};
function massForSize(size: string): number {
  const k = String(size || "").toUpperCase().trim();
  const m = k.match(/^(10M|15M|20M|25M|30M|35M|#[3-8])/);
  return m ? REBAR_MASS_KG_PER_M[m[1]] || 0 : 0;
}

function isOpenStatus(status?: string | null) {
  return !CLOSED_STATUSES.has(String(status || "").toLowerCase());
}

function coercePayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function pickStr(...vals: any[]): string | null {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

// "p12", "page 12", "12" → null (page tag, not a real sheet id)
function isPageTag(v: string | null | undefined): boolean {
  if (!v) return true;
  return /^(p|page)?\s*\d+$/i.test(String(v).trim());
}

export function buildLocationLabel(loc: WorkflowQaIssue["location"], fallbackSheet?: string | null): string | null {
  if (!loc && !fallbackSheet) return null;
  const parts: string[] = [];
  const sheet = (loc?.source_sheet && !isPageTag(loc.source_sheet)) ? loc.source_sheet
              : (fallbackSheet && !isPageTag(fallbackSheet)) ? fallbackSheet
              : null;
  if (sheet) parts.push(`Sheet ${sheet}`);
  if (loc?.page_number) parts.push(`Page ${loc.page_number}`);
  if (loc?.detail_reference) parts.push(`Detail ${loc.detail_reference}`);
  if (loc?.grid_reference) parts.push(`Grid ${loc.grid_reference}`);
  if (loc?.zone_reference) parts.push(loc.zone_reference);
  if (loc?.element_reference) parts.push(loc.element_reference);
  return parts.length > 0 ? parts.join(" · ") : null;
}

// Build the location-led question text shown in the QA panel.
// Always lead with the most specific location available; fall back to source excerpt.
function buildQuestionText(
  label: string | null,
  loc: WorkflowQaIssue["location"],
  originalDescription: string | null | undefined,
  fallbackTitle: string | null | undefined,
): string {
  const rawDesc = originalDescription ? String(originalDescription).trim() : "";
  const rawTitle = fallbackTitle ? String(fallbackTitle).trim() : "";
  // Try plain three-step rewrite first ("Look at … Find … Enter …").
  const rewritten = rewriteToRawInputAsk(rawDesc, rawTitle, loc, label);
  if (rewritten) return rewritten;
  // Fall back to the original message, prefixed with the location for context.
  const body = rawDesc
    || rawTitle
    || "Enter the dimensions shown on the drawing.";
  if (label) return `${label}: ${body}`;
  if (loc?.page_number) return `Page ${loc.page_number}: ${body}`;
  if (loc?.source_excerpt) {
    const ex = String(loc.source_excerpt).slice(0, 120);
    return `Source: "${ex}" — ${body}`;
  }
  return body;
}

// ---------------------------------------------------------------------------
// Raw-input ask rewriter (deterministic, no AI).
// Turns "Missing: perimeter; element dimensions" into a sentence that asks the
// estimator only for raw drawing values and tells them what the system will
// compute from those values.
// ---------------------------------------------------------------------------
function classifyElement(text: string): "slab_edge"|"strip_footing"|"pad"|"wall"|"cage"|"generic" {
  const t = text.toLowerCase();
  if (/\b(slab\s*edge|frost\s*slab|slab\s*on\s*grade|sog\b|edge\s*of\s*slab)/.test(t)) return "slab_edge";
  if (/\b(strip\s*footing|cont(?:inuous)?\s*footing|wall\s*footing|footing|ftg)\b/.test(t)) return "strip_footing";
  if (/\b(housekeeping\s*pad|equipment\s*pad|pad)\b/.test(t)) return "pad";
  if (/\b(wall|stem\s*wall|foundation\s*wall|retaining\s*wall)\b/.test(t)) return "wall";
  if (/\b(column|pier|cage|tie\s*column)\b/.test(t)) return "cage";
  return "generic";
}

function elementNoun(c: ReturnType<typeof classifyElement>): string {
  return ({
    slab_edge: "slab",
    strip_footing: "strip footing",
    pad: "housekeeping pad",
    wall: "wall",
    cage: "column or pier",
    generic: "element",
  })[c];
}

function rawInputForToken(token: string, c: ReturnType<typeof classifyElement>): string | null {
  const k = token.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (/(perimeter|edge_length|edge_run|run_length|^length$|total_length|element_length)/.test(k)) {
    if (c === "slab_edge") return "the slab length and slab width";
    if (c === "wall")      return "the wall length";
    if (c === "pad")       return "the pad length and pad width";
    if (c === "strip_footing") return "the footing length";
    return "the length";
  }
  if (/(wall_height|^height$)/.test(k)) return "the wall height";
  if (/(pad_length|pad_width|element_dimensions|dimensions|footprint|plan_dim)/.test(k)) {
    if (c === "wall") return "the wall length and wall height";
    if (c === "slab_edge") return "the slab length and slab width";
    if (c === "pad") return "the pad length and pad width";
    return "the length and width";
  }
  if (/(spacing|o_c|on_center)/.test(k)) return "the bar spacing";
  if (/(count|qty|quantity)/.test(k)) return "the bar count";
  if (/(rebar_callout|^callout$|bar_callout|mark)/.test(k)) return "the rebar callout text";
  if (/(cover)/.test(k)) return "the concrete cover";
  if (/(thickness)/.test(k)) return "the thickness";
  if (/(diameter)/.test(k)) return "the diameter";
  return null;
}

function rewriteToRawInputAsk(
  desc: string,
  title: string,
  loc: WorkflowQaIssue["location"],
  label: string | null,
): string | null {
  const text = `${title}\n${desc}`;
  const looksUnresolved = /^(missing\b|unresolved geometry)/i.test(desc.trim())
    || /unresolved geometry|missing\s+(refs?|dimensions?|callout)/i.test(text);
  const looksDerivedAsk = /\b(verify|confirm|find|calculate|compute)\b.*\b(total|length|run|perimeter|qty|quantity|count|weight)\b/i.test(text);
  // Also catch the legacy "at the <noun>: enter … so the system can calculate …" wording.
  const looksLegacyAsk = /so the system can calculate|^at the \w/i.test(text);
  if (!looksUnresolved && !looksDerivedAsk && !looksLegacyAsk) return null;

  const missingMatch = desc.match(/missing\s*:\s*([^\n]+)/i);
  const tokens = missingMatch
    ? missingMatch[1].split(/[;,]/).map((s) => s.trim()).filter(Boolean)
    : [];

  const calloutText = (loc?.element_reference || "").trim();
  const elementClass = classifyElement(`${calloutText} ${title} ${desc}`);

  const phrases: string[] = [];
  for (const t of tokens) {
    const p = rawInputForToken(t, elementClass);
    if (p && !phrases.includes(p)) phrases.push(p);
  }
  if (phrases.length === 0) {
    const defaults: Record<string, string[]> = {
      slab_edge: ["the slab length and slab width"],
      strip_footing: ["the footing length"],
      pad: ["the pad length and pad width"],
      wall: ["the wall length and wall height"],
      cage: ["the column or pier dimensions, tie spacing, and overall height"],
      generic: ["the dimensions and bar callout"],
    };
    phrases.push(...defaults[elementClass]);
  }

  const noun = elementNoun(elementClass);
  const inputList = phrases.length === 1
    ? phrases[0]
    : phrases.slice(0, -1).join(", ") + ", and " + phrases[phrases.length - 1];

  // Three plain-language steps: Look at … / Find … / Enter …
  const lookAt = label && label.trim().length > 0
    ? label.trim()
    : (loc?.page_number ? `Page ${loc.page_number}` : "the drawing");
  const findPart = calloutText
    ? `the ${noun} marked "${calloutText}"`
    : `the ${noun}`;
  return `Look at ${lookAt}. Find ${findPart}. Enter ${inputList} from the drawing.`;
}

function extractLocationFromRef(ref: any, aj: Record<string, any>, fallback: { sheet_id?: string | null }) {
  const r = ref || {};
  const nestedR = (r.location && typeof r.location === "object") ? r.location : {};
  const nestedA = (aj.location && typeof aj.location === "object") ? aj.location as Record<string, any> : {};
  return {
    source_sheet: pickStr(nestedR.sheet, nestedA.sheet, r.sheet, r.sheet_id, r.source_sheet, aj.sheet, aj.sheet_id, aj.source_sheet, fallback.sheet_id),
    page_number: Number(nestedR.page_number ?? nestedA.page_number ?? r.page_number ?? aj.page_number ?? 0) || null,
    detail_reference: pickStr(nestedR.detail, nestedA.detail, r.detail, r.detail_reference, aj.detail, aj.detail_reference),
    grid_reference: pickStr(nestedR.grid, nestedA.grid, r.grid, r.grid_reference, aj.grid, aj.grid_reference),
    zone_reference: pickStr(nestedR.zone, nestedA.zone, r.zone, r.zone_reference, aj.zone, aj.zone_reference, aj.area, r.area, nestedR.area, nestedA.area),
    element_reference: pickStr(
      nestedR.element, nestedA.element, r.element, r.element_reference, r.mark, r.callout,
      r.wall, r.wall_name, r.footing, r.footing_name, r.pad, r.pad_name,
      aj.element, aj.element_reference, aj.mark, aj.callout,
      aj.wall, aj.wall_name, aj.footing, aj.footing_name, aj.pad, aj.pad_name,
    ),
    source_excerpt: pickStr(nestedR.excerpt, nestedA.excerpt, r.excerpt, r.source_excerpt, aj.excerpt, aj.source_excerpt),
  };
}

async function getCanonicalTakeoffRuns(legacyProjectId: string) {
  const rebarProjectId = await getRebarProjectIdByLegacyId(supabase, legacyProjectId).catch((error) => {
    console.warn("Failed to resolve canonical takeoff project:", error);
    return null;
  });
  if (!rebarProjectId) return [];

  const { data, error } = await (supabase as any)
    .schema("rebar")
    .from("takeoff_runs")
    .select("id,status,created_at,completed_at,source_revision_label,overall_confidence")
    .eq("project_id", rebarProjectId)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("Failed to load canonical takeoff runs:", error);
    return [];
  }
  return data || [];
}

async function loadLegacyTakeoffRows(projectId: string, files: WorkflowFileRef[]): Promise<WorkflowTakeoffRow[]> {
  const { data, error } = await supabase
    .from("estimate_items")
    .select("id, bar_size, description, quantity_count, total_length, total_weight, status, confidence, source_file_id, segment_id, assumptions_json")
    .eq("project_id", projectId)
    .limit(500);

  if (error) {
    console.warn("Failed to load legacy takeoff rows:", error);
    return [];
  }

  // Resolve segment names in one shot
  const segIds = Array.from(new Set((data || []).map((r) => r.segment_id).filter(Boolean) as string[]));
  const segMap = new Map<string, string>();
  if (segIds.length) {
    const { data: segs } = await supabase.from("segments").select("id,name").in("id", segIds);
    (segs || []).forEach((s) => segMap.set(s.id, s.name));
  }

  // Pull real bar marks from bar_items where available
  const itemIds = (data || []).map((r) => r.id);
  const markMap = new Map<string, string>();
  if (itemIds.length) {
    const { data: bars } = await supabase
      .from("bar_items")
      .select("estimate_item_id, mark")
      .in("estimate_item_id", itemIds);
    (bars || []).forEach((b: any) => {
      if (b.estimate_item_id && b.mark && !markMap.has(b.estimate_item_id)) {
        markMap.set(b.estimate_item_id, String(b.mark));
      }
    });
  }

  return (data || []).map((row, index: number) => {
    const file = files.find((candidate) => candidate.legacy_file_id === row.source_file_id || candidate.id === row.source_file_id);
    const realMark = markMap.get(row.id);
    const rawLen = Number(row.total_length || 0);
    let rawWgt = Number(row.total_weight || 0);
    if (rawWgt === 0 && rawLen > 0) {
      const mass = massForSize(row.bar_size || "");
      if (mass > 0) rawWgt = +(rawLen * mass).toFixed(2);
    }
    const assum = (row.assumptions_json || {}) as Record<string, unknown>;
    const geomRaw = String(assum.geometry_status || "").toLowerCase();
    const geometry_status: WorkflowTakeoffRow["geometry_status"] =
      geomRaw === "resolved" || geomRaw === "partial" ? geomRaw
      : geomRaw === "unresolved" ? "unresolved"
      // Legacy rows pre-resolver: infer from values
      : (rawLen === 0 && (row.quantity_count || 0) === 0) ? "unresolved"
      : rawLen > 0 ? "resolved" : "partial";
    const missing_refs = Array.isArray(assum.missing_refs) ? (assum.missing_refs as string[]) : [];
    const computedStatus: WorkflowTakeoffRow["status"] =
      geometry_status === "unresolved" ? "blocked"
      : row.status === "approved" ? "ready"
      : Number(row.confidence) < 0.6 ? "blocked"
      : "review";
    return {
      id: `legacy:${row.id}`,
      raw_id: row.id,
      raw_kind: "legacy" as const,
      mark: realMark || `M${String(index + 1).padStart(3, "0")}`,
      size: row.bar_size || "-",
      shape: (row.description || "Straight").slice(0, 40),
      count: row.quantity_count || 0,
      length: rawLen,
      weight: rawWgt,
      status: computedStatus,
      source: file?.file_name || "Legacy estimate",
      segment_id: row.segment_id || null,
      segment_name: row.segment_id ? (segMap.get(row.segment_id) || "Unassigned") : "Unassigned",
      source_file_id: file?.id || row.source_file_id || null,
      geometry_status,
      missing_refs,
      page_number: Number(assum.page_number || 0) || null,
    };
  });
}

async function loadCanonicalTakeoffRows(projectId: string): Promise<WorkflowTakeoffRow[]> {
  const runs = await getCanonicalTakeoffRuns(projectId);
  const runIds = runs.map((run: any) => run.id);
  if (runIds.length === 0) return [];
  const runById = new Map(runs.map((run: any) => [run.id, run]));

  const { data, error } = await (supabase as any)
    .schema("rebar")
    .from("takeoff_items")
    .select("id,takeoff_run_id,element_type,shape_type,bar_size,quantity,total_length_m,total_weight_kg,confidence,source_text,drawing_reference,extraction_payload,created_at")
    .in("takeoff_run_id", runIds)
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) {
    console.warn("Failed to load canonical takeoff rows:", error);
    return [];
  }

  return (data || []).map((row: any, index: number) => {
    const run = runById.get(row.takeoff_run_id) as Record<string, unknown> | undefined;
    const payload = coercePayload(row.extraction_payload);
    const confidence = Number(row.confidence || 0);
    const len = Number(row.total_length_m || 0);
    const qty = Number(row.quantity || 0);
    const geometry_status: WorkflowTakeoffRow["geometry_status"] =
      len > 0 ? "resolved" : qty > 0 ? "partial" : "unresolved";
    return {
      id: `canonical:${row.id}`,
      raw_id: row.id,
      raw_kind: "canonical" as const,
      mark: `T${String(index + 1).padStart(3, "0")}`,
      size: row.bar_size || "-",
      shape: String(row.source_text || `${row.element_type || "Element"} / ${row.shape_type || "straight"}`).slice(0, 40),
      count: qty,
      length: len,
      weight: Number(row.total_weight_kg || 0),
      status: (geometry_status === "unresolved" ? "blocked" : run?.status === "ready_for_review" ? "ready" : confidence < 0.6 ? "blocked" : "review") as WorkflowTakeoffRow["status"],
      source: String(payload.source_file_name || row.drawing_reference || run?.source_revision_label || "Canonical takeoff"),
      segment_id: null,
      segment_name: String(row.element_type || "Canonical"),
      source_file_id: null,
      geometry_status,
      missing_refs: [],
    };
  });
}

export async function loadWorkflowTakeoffRows(projectId: string, files: WorkflowFileRef[]) {
  const [legacyRows, canonicalRows] = await Promise.all([
    loadLegacyTakeoffRows(projectId, files),
    loadCanonicalTakeoffRows(projectId),
  ]);
  return [...legacyRows, ...canonicalRows];
}

export async function getWorkflowTakeoffRowCount(projectId: string) {
  const legacyCountReq = supabase
    .from("estimate_items")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);

  const canonicalRuns = await getCanonicalTakeoffRuns(projectId);
  const runIds = canonicalRuns.map((run: any) => run.id);
  const canonicalCountReq = runIds.length > 0
    ? (supabase as any).schema("rebar").from("takeoff_items").select("id", { count: "exact", head: true }).in("takeoff_run_id", runIds)
    : Promise.resolve({ count: 0, error: null });

  const [legacyCount, canonicalCount] = await Promise.all([legacyCountReq, canonicalCountReq]);
  if (legacyCount.error) console.warn("Failed to count legacy takeoff rows:", legacyCount.error);
  if (canonicalCount.error) console.warn("Failed to count canonical takeoff rows:", canonicalCount.error);

  return (legacyCount.count || 0) + (canonicalCount.count || 0);
}

async function loadCanonicalQaIssues(projectId: string): Promise<WorkflowQaIssue[]> {
  const runs = await getCanonicalTakeoffRuns(projectId);
  const runIds = runs.map((run: any) => run.id);
  if (runIds.length === 0) return [];

  const { data, error } = await (supabase as any)
    .schema("rebar")
    .from("takeoff_warnings")
    .select("id,takeoff_item_id,warning_code,severity,message,created_at")
    .in("takeoff_run_id", runIds)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("Failed to load canonical QA warnings:", error);
    return [];
  }

  return (data || []).map((warning: any) => ({
    id: `canonical:${warning.id}`,
    title: String(warning.warning_code || "takeoff_warning").replace(/_/g, " "),
    description: warning.message || null,
    severity: warning.severity || "warning",
    status: "open",
    sheet_id: warning.takeoff_item_id || null,
    issue_type: "takeoff_warning",
    source_file_id: null,
    source_refs: null,
  }));
}

// For canonical warnings, hydrate location fields from rebar.takeoff_items
async function enrichCanonicalIssueLocations(issues: WorkflowQaIssue[]) {
  const itemIds = Array.from(new Set(
    issues.map((i) => i.sheet_id).filter((v): v is string => !!v)
  ));
  if (itemIds.length === 0) return;
  const { data, error } = await (supabase as any)
    .schema("rebar")
    .from("takeoff_items")
    .select("id,drawing_reference,extraction_payload,source_text,element_type")
    .in("id", itemIds);
  if (error) { console.warn("enrichCanonicalIssueLocations failed:", error); return; }
  const byId = new Map<string, any>((data || []).map((r: any) => [r.id, r]));
  for (const iss of issues) {
    const item = iss.sheet_id ? byId.get(iss.sheet_id) : null;
    if (!item) continue;
    const payload = (item.extraction_payload && typeof item.extraction_payload === "object") ? item.extraction_payload : {};
    const loc = extractLocationFromRef(payload, {}, { sheet_id: item.drawing_reference || null });
    if (!loc.element_reference && item.element_type) loc.element_reference = String(item.element_type);
    if (!loc.source_excerpt && item.source_text) loc.source_excerpt = String(item.source_text).slice(0, 160);
    iss.location = loc;
  }
}

export async function loadWorkflowQaIssues(projectId: string): Promise<WorkflowQaIssue[]> {
  const legacyReq = supabase
    .from("validation_issues")
    .select("id,title,description,severity,status,sheet_id,issue_type,source_file_id,source_refs")
    .eq("project_id", projectId)
    .order("severity", { ascending: true });

  const [legacyRes, canonicalIssues] = await Promise.all([legacyReq, loadCanonicalQaIssues(projectId)]);
  if (legacyRes.error) console.warn("Failed to load legacy QA issues:", legacyRes.error);

  const legacyIssues = ((legacyRes.data || []) as WorkflowQaIssue[])
    .filter((issue) => isOpenStatus(issue.status))
    .map((issue) => ({ ...issue, id: `legacy:${issue.id}` }));

  // Backfill locator + linked_item from estimate_items.assumptions_json
  const itemIds: string[] = [];
  for (const iss of legacyIssues) {
    const ref = Array.isArray(iss.source_refs) ? iss.source_refs[0] : null;
    const eid = ref?.estimate_item_id;
    if (eid) itemIds.push(eid);
  }
  if (itemIds.length > 0) {
    const { data: items } = await supabase
      .from("estimate_items")
      .select("id, description, bar_size, quantity_count, total_length, total_weight, assumptions_json")
      .in("id", itemIds);
    const byId = new Map<string, any>((items || []).map((r: any) => [r.id, r]));
    for (const iss of legacyIssues) {
      const ref = Array.isArray(iss.source_refs) ? iss.source_refs[0] : null;
      const eid = ref?.estimate_item_id;
      const item = eid ? byId.get(eid) : null;
      const aj = (item?.assumptions_json || {}) as Record<string, any>;
      iss.locator = {
        page_number: ref?.page_number ?? aj.page_number ?? null,
        bbox: ref?.bbox ?? aj.bbox ?? null,
        image_size: ref?.image_size ?? aj.image_size ?? null,
        anchor_confidence: Number(ref?.anchor_confidence ?? aj.anchor_confidence ?? 0) || null,
        anchor_mode: ref?.anchor_mode ?? aj.anchor_mode ?? null,
      };
      if (item) {
        iss.linked_item = {
          id: item.id,
          description: item.description,
          bar_size: item.bar_size,
          quantity_count: Number(item.quantity_count || 0),
          total_length: Number(item.total_length || 0),
          total_weight: Number(item.total_weight || 0),
          missing_refs: Array.isArray(aj.missing_refs) ? aj.missing_refs : (ref?.missing || []),
          source_file_id: item.source_file_id || iss.source_file_id || null,
          segment_id: item.segment_id || null,
          page_number: Number(ref?.page_number ?? aj.page_number ?? 0) || null,
        };
      }
      if (!iss.source_file_id && item?.source_file_id) iss.source_file_id = item.source_file_id;
      // Build structured location & visible label
      const loc = extractLocationFromRef(ref, aj, { sheet_id: iss.sheet_id });
      iss.location = loc;
      iss.location_label = buildLocationLabel(loc, iss.sheet_id);
      iss.raw_description = iss.description ?? null;
      iss.description = buildQuestionText(iss.location_label, loc, iss.description, iss.title);
      if (iss.location_label && !String(iss.title || "").startsWith(iss.location_label)) {
        iss.title = `${iss.location_label}: ${iss.title || iss.issue_type || "review item"}`;
      }
    }
  }

  // Ensure every issue has a location_label even without linked items
  for (const iss of legacyIssues) {
    if (iss.location_label || iss.raw_description !== undefined) continue;
    const ref = Array.isArray(iss.source_refs) ? iss.source_refs[0] : null;
    const loc = extractLocationFromRef(ref, {}, { sheet_id: iss.sheet_id });
    iss.location = loc;
    iss.location_label = buildLocationLabel(loc, iss.sheet_id);
    iss.raw_description = iss.description ?? null;
    iss.description = buildQuestionText(iss.location_label, loc, iss.description, iss.title);
    if (iss.location_label && !String(iss.title || "").startsWith(iss.location_label)) {
      iss.title = `${iss.location_label}: ${iss.title || iss.issue_type || "review item"}`;
    }
  }

  // Canonical issues: enrich location from takeoff_items, then prefix
  await enrichCanonicalIssueLocations(canonicalIssues);
  for (const iss of canonicalIssues) {
    iss.location_label = buildLocationLabel(iss.location, null)
      || (iss.sheet_id ? `Item ${String(iss.sheet_id).slice(0, 8)}` : null);
    iss.raw_description = iss.description ?? null;
    iss.description = buildQuestionText(iss.location_label, iss.location, iss.description, iss.title);
    if (iss.location_label && !String(iss.title || "").startsWith(iss.location_label)) {
      iss.title = `${iss.location_label}: ${iss.title || iss.issue_type || "review item"}`;
    }
  }

  return [...legacyIssues, ...canonicalIssues];
}

export async function getWorkflowQaCounts(projectId: string) {
  const issues = await loadWorkflowQaIssues(projectId);
  return {
    open: issues.length,
    critical: issues.filter((issue) => ["critical", "error"].includes(issue.severity?.toLowerCase())).length,
  };
}

export async function getWorkflowEstimatorSignoff(projectId: string) {
  const { data, error } = await supabase
    .from("approvals")
    .select("id")
    .eq("project_id", projectId)
    .is("segment_id", null)
    .eq("approval_type", "estimator_signoff")
    .eq("status", "approved")
    .limit(1);

  if (error) {
    console.warn("Failed to load estimator signoff:", error);
    return false;
  }
  return (data || []).length > 0;
}

export async function saveWorkflowEstimatorSignoff(projectId: string, userId: string) {
  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from("approvals")
    .select("id")
    .eq("project_id", projectId)
    .is("segment_id", null)
    .eq("approval_type", "estimator_signoff")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    return supabase
      .from("approvals")
      .update({ status: "approved", resolved_at: now, notes: "Estimator signoff recorded in V2 workflow." })
      .eq("id", existing.id);
  }

  return supabase.from("approvals").insert({
    project_id: projectId,
    segment_id: null,
    user_id: userId,
    approval_type: "estimator_signoff",
    status: "approved",
    reviewer_name: "Estimator",
    notes: "Estimator signoff recorded in V2 workflow.",
    resolved_at: now,
  });
}

export async function clearWorkflowEstimatorSignoff(projectId: string) {
  return supabase
    .from("approvals")
    .update({ status: "pending", resolved_at: null, notes: "Returned to QA from V2 workflow." })
    .eq("project_id", projectId)
    .is("segment_id", null)
    .eq("approval_type", "estimator_signoff");
}
