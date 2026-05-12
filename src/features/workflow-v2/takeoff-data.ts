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
  synthetic?: boolean;
  synthetic_basis?: string | null;
}

export interface WorkflowQaIssue {
  id: string;
  title: string;
  description?: string | null;
  severity: string;
  status: string;
  resolution_note?: string | null;
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
    anchor_text?: string | null;
    anchor_kind?: string | null;
  } | null;
  linked_item?: { id: string; description: string | null; bar_size: string | null; quantity_count: number; total_length: number; total_weight: number; missing_refs: string[]; source_file_id?: string | null; segment_id?: string | null; page_number?: number | null; schedule_mark?: string | null; schedule_source_page?: number | null } | null;
  // Structured drawing location (used to prefix question text)
  location?: {
    source_sheet?: string | null;
    page_number?: number | null;
    detail_reference?: string | null;
    section_reference?: string | null;
    callout_tag?: string | null;
    element_id?: string | null;
    footing_id?: string | null;
    wall_id?: string | null;
    pad_id?: string | null;
    slab_zone_id?: string | null;
    grid_reference?: string | null;
    zone_reference?: string | null;
    element_reference?: string | null;
    schedule_row_identity?: string | null;
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

// "p12", "page 12", "12" are page tags, not real object anchors.
function isPageTag(v: string | null | undefined): boolean {
  if (!v) return true;
  return /^(p|page)?\s*\d+$/i.test(String(v).trim());
}

function pickAnchorStr(...vals: any[]): string | null {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s && !isPageTag(s)) return s;
  }
  return null;
}

function pickObjectIdentity(loc: WorkflowQaIssue["location"]): string | null {
  return pickAnchorStr(
    loc?.element_id,
    loc?.pad_id,
    loc?.footing_id,
    loc?.wall_id,
    loc?.slab_zone_id,
    loc?.callout_tag,
    loc?.schedule_row_identity,
    loc?.detail_reference,
    loc?.grid_reference,
    loc?.section_reference,
  );
}

export function buildLocationLabel(loc: WorkflowQaIssue["location"], fallbackSheet?: string | null): string | null {
  if (!loc && !fallbackSheet) return null;
  // Compact, object-first label. Preferred form: "P12-T.D.33" (page + detail/section/callout).
  const page = loc?.page_number ? `P${loc.page_number}` : null;
  const sheet = (loc?.source_sheet && !isPageTag(loc.source_sheet)) ? loc.source_sheet
              : (fallbackSheet && !isPageTag(fallbackSheet)) ? fallbackSheet
              : null;
  // Pick the most specific *object* anchor. Page tokens never qualify here.
  const callout = loc?.callout_tag && !isPageTag(loc.callout_tag) ? loc.callout_tag : null;
  const elementId = loc?.element_id && !isPageTag(loc.element_id) ? loc.element_id : null;
  const detail = loc?.detail_reference && !isPageTag(loc.detail_reference) ? loc.detail_reference : null;
  const section = loc?.section_reference && !isPageTag(loc.section_reference) ? loc.section_reference : null;
  const grid = loc?.grid_reference && !isPageTag(loc.grid_reference) ? loc.grid_reference : null;
  const schedule = loc?.schedule_row_identity && !isPageTag(loc.schedule_row_identity) ? loc.schedule_row_identity : null;
  const obj = detail
    || section
    || callout
    || grid
    || schedule
    || elementId
    || null;

  const parts: string[] = [];
  const seen = new Set<string>();
  const push = (s: string | null | undefined) => {
    if (!s) return;
    const k = s.trim().toLowerCase();
    if (!k || seen.has(k)) return;
    seen.add(k);
    parts.push(s);
  };

  if (page && obj) {
    push(`${page}-${obj}`);
  } else {
    push(sheet);
    push(page);
    push(obj);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function cleanPhrase(value: string | null | undefined): string | null {
  const s = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[@,:;\-\s]+|[@,:;\-\s]+$/g, "")
    .trim();
  return s || null;
}

function titleCase(value: string | null | undefined): string | null {
  const s = cleanPhrase(value);
  if (!s) return null;
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function normalizeDetailReference(value: string | null | undefined): string | null {
  const s = pickAnchorStr(value);
  if (!s) return null;
  const td = s.match(/^(?:T\.?\s*D\.?|TD)[\s#:.-]*([A-Z0-9][A-Z0-9./-]*)$/i);
  return td ? `T.D.${td[1]}` : s;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanIssueText(value: string | null | undefined, label: string | null): string | null {
  let s = cleanPhrase(value);
  if (!s) return null;
  if (label) {
    s = s.replace(new RegExp(`^${escapeRegex(label)}\\s*[:\\-–—·|]*\\s*`, "i"), "");
  }
  s = s
    .replace(/\b(?:sheet|callout|anchor|element)\s+(?:p|page)\s*\d+\b/gi, "")
    .replace(/\bpage\s*(?:p|page)?\s*\d+\b/gi, "")
    .replace(/(^|[\s:;,\-–—·|])(?:p|page)\s*\d+\b(?=$|[\s:;,\-–—·|])/gi, "$1")
    .replace(/(?:\s*[:\-–—·|]\s*){2,}/g, " - ")
    .replace(/^\s*[:\-–—·|]+\s*|\s*[:\-–—·|]+\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return s || null;
}

function applyLocationText(issue: WorkflowQaIssue, loc: WorkflowQaIssue["location"], fallbackSheet?: string | null) {
  const label = buildLocationLabel(loc, fallbackSheet);
  const originalTitle = issue.title ?? issue.issue_type ?? "review item";
  const originalDescription = issue.description ?? null;
  const cleanedTitle = cleanIssueText(originalTitle, label);
  const cleanedDescription = cleanIssueText(originalDescription, label);
  const titleBody = cleanedTitle || issue.issue_type || "review item";

  issue.location = loc;
  issue.location_label = label;
  issue.raw_description = originalDescription;
  issue.description = buildQuestionText(label, loc, cleanedDescription, titleBody);
  issue.title = label ? `${label}: ${titleBody}` : titleBody;
}

function inferObjectAnchor(...vals: Array<string | null | undefined>): {
  detail_reference?: string | null;
  section_reference?: string | null;
  callout_tag?: string | null;
  element_id?: string | null;
  grid_reference?: string | null;
  zone_reference?: string | null;
  element_reference?: string | null;
  schedule_row_identity?: string | null;
} {
  const text = vals.filter(Boolean).join(" \n ");
  const upper = text.toUpperCase();

  const objectPatterns: Array<[RegExp, (m: RegExpMatchArray) => string | null]> = [
    [/\bTOP OF BRICK LEDGE\b/i, () => "brick ledge"],
    [/\bBRICK LEDGE\b/i, () => "brick ledge"],
    [/\bHOUSEKEEPING PAD\b/i, () => "housekeeping pad"],
    [/\bEQUIPMENT PAD\b/i, () => "equipment pad"],
    [/\bLEVEL(?:I|E)NG PAD\b(?:[^\n]{0,40}?\bENTRANCE DOOR\b)?/i, (m) => /ENTRANCE DOOR/i.test(m[0]) ? "leveling pad at entrance door" : "leveling pad"],
    [/\bFOUNDATION WALL\b(?:[^\n]{0,40}?\bENTRANCE DOOR\b)?/i, (m) => /ENTRANCE DOOR/i.test(m[0]) ? "foundation wall at entrance door" : "foundation wall"],
    [/\bFROST SLAB EDGE\b/i, () => "frost slab edge"],
    [/\bSLAB EDGE\b/i, () => "slab edge"],
    [/\bSTRIP FOOTING\b/i, () => "strip footing"],
    [/\bCONT(?:INUOUS)? FOOTING\b/i, () => "continuous footing"],
    [/\bDOOR OPENING\b/i, () => "door opening"],
  ];

  const zoneMatch = upper.match(/\b(?:AT|ALONG|NEAR)\s+(EXTENT OF\s+[A-Z][A-Z\s]+|ENTRANCE DOOR|WEST SIDE|EAST SIDE|NORTH SIDE|SOUTH SIDE)\b/);
  const zoneReference = zoneMatch ? titleCase(zoneMatch[1]) : null;

  let elementReference: string | null = null;
  for (const [rx, map] of objectPatterns) {
    const match = text.match(rx);
    if (!match) continue;
    elementReference = cleanPhrase(map(match));
    break;
  }
  if (!elementReference && zoneReference) elementReference = zoneReference.toLowerCase();

  const sectionReference = pickAnchorStr(text.match(/\bSECTION\s+([A-Z0-9./-]+)/i)?.[1] || null);
  const detailReference = normalizeDetailReference(
    text.match(/\b(?:DETAIL|DET\.?)[\s#:]*((?:T\.?\s*D\.?|TD)[\s#:.-]*[A-Z0-9][A-Z0-9./-]*|[A-Z0-9][A-Z0-9./-]*)/i)?.[1]
      || text.match(/\b((?:T\.?\s*D\.?|TD)[\s#:.-]*[A-Z0-9][A-Z0-9./-]*)\b/i)?.[1]
      || null
  );
  const ELEMENT_ID_RX = /\b(HKP\d+|EQP\d+|FW\d+|WF\d+|SF\d+|SOG\d+|SL\d+|FZ\d+|COL\d+|PIER\d+|PR\d+|BS?\d{2,4}|B\d{4}|F\d{1,3}|W\d{1,3}|GB\d{1,3}|D\d{2}(?:-\d+)?|S-\d+)\b/i;
  const calloutTag = pickAnchorStr(text.match(ELEMENT_ID_RX)?.[1] || null);
  const elementId = calloutTag ? calloutTag.toUpperCase() : null;
  const scheduleRowIdentity = pickAnchorStr(
    text.match(/\b(?:SCHEDULE|ROW)\s+([A-Z0-9./-]+)/i)?.[1],
    calloutTag,
  );
  const gridReference = pickAnchorStr(
    text.match(/\bGRID\s+([A-Z]+-?\d+[A-Z]?)\b/i)?.[1] || null
  );

  return {
    detail_reference: detailReference,
    section_reference: sectionReference,
    callout_tag: calloutTag,
    element_id: elementId,
    grid_reference: gridReference,
    zone_reference: zoneReference,
    element_reference: elementReference,
    schedule_row_identity: scheduleRowIdentity && /^(10M|15M|20M|25M|30M|35M)$/i.test(scheduleRowIdentity) ? null : scheduleRowIdentity,
  };
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
  if (/\b(housekeeping\s*pad|equipment\s*pad)\b/.test(t)) return "pad";
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
  const objectIdentity = pickObjectIdentity(loc);
  const findPart = objectIdentity
    ? `${noun} ${objectIdentity}`
    : calloutText && !isPageTag(calloutText)
      ? `the ${noun} marked "${calloutText}"`
      : `the ${noun}`;
  return `Look at ${lookAt}. Find ${findPart}. Enter ${inputList} from the drawing.`;
}

function extractLocationFromRef(ref: any, aj: Record<string, any>, fallback: { sheet_id?: string | null }) {
  const r = ref || {};
  const nestedR = (r.location && typeof r.location === "object") ? r.location : {};
  const nestedA = (aj.location && typeof aj.location === "object") ? aj.location as Record<string, any> : {};
  const inferred = inferObjectAnchor(
    pickStr(r.description, aj.description, r.excerpt, r.source_excerpt, aj.excerpt, aj.source_excerpt),
    pickStr(r.element, r.element_reference, aj.element, aj.element_reference),
    pickStr(r.zone, r.zone_reference, aj.zone, aj.zone_reference),
  );
  return {
    source_sheet: pickStr(nestedR.sheet, nestedA.sheet, r.sheet, r.sheet_id, r.source_sheet, aj.sheet, aj.sheet_id, aj.source_sheet, fallback.sheet_id),
    page_number: Number(nestedR.page_number ?? nestedA.page_number ?? r.page_number ?? aj.page_number ?? 0) || null,
    detail_reference: normalizeDetailReference(pickAnchorStr(nestedR.detail, nestedA.detail, r.detail, r.detail_reference, aj.detail, aj.detail_reference, inferred.detail_reference)),
    section_reference: pickAnchorStr(nestedR.section, nestedA.section, r.section, r.section_reference, aj.section, aj.section_reference, inferred.section_reference),
    callout_tag: pickAnchorStr(r.callout_tag, aj.callout_tag, inferred.callout_tag),
    element_id: pickAnchorStr(r.element_id, aj.element_id, inferred.element_id),
    footing_id: pickAnchorStr(r.footing_id, aj.footing_id),
    wall_id: pickAnchorStr(r.wall_id, aj.wall_id),
    pad_id: pickAnchorStr(r.pad_id, aj.pad_id),
    slab_zone_id: pickAnchorStr(r.slab_zone_id, aj.slab_zone_id),
    grid_reference: pickAnchorStr(nestedR.grid, nestedA.grid, r.grid, r.grid_reference, aj.grid, aj.grid_reference, inferred.grid_reference),
    zone_reference: pickAnchorStr(nestedR.zone, nestedA.zone, r.zone, r.zone_reference, aj.zone, aj.zone_reference, aj.area, r.area, nestedR.area, nestedA.area, inferred.zone_reference),
    element_reference: pickAnchorStr(
      nestedR.element, nestedA.element, r.element, r.element_reference, r.mark, r.callout,
      r.wall, r.wall_name, r.footing, r.footing_name, r.pad, r.pad_name,
      aj.element, aj.element_reference, aj.mark, aj.callout,
      aj.wall, aj.wall_name, aj.footing, aj.footing_name, aj.pad, aj.pad_name,
      inferred.element_reference,
    ),
    schedule_row_identity: pickAnchorStr(r.schedule_row_identity, aj.schedule_row_identity, inferred.schedule_row_identity),
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
      synthetic: Boolean(assum.synthetic_estimate),
      synthetic_basis: typeof assum.synthetic_basis === "string" ? assum.synthetic_basis as string : null,
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
    .select("id,title,description,severity,status,resolution_note,sheet_id,issue_type,source_file_id,source_refs")
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
        anchor_text: ref?.anchor_text ?? aj.anchor_text ?? null,
        anchor_kind: ref?.anchor_kind ?? aj.anchor_kind ?? null,
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
          schedule_mark: aj.schedule_mark || null,
          schedule_source_page: aj.schedule_source_page || null,
        };
      }
      if (!iss.source_file_id && item?.source_file_id) iss.source_file_id = item.source_file_id;
      // Build structured location & visible label
      const loc = extractLocationFromRef(ref, aj, { sheet_id: iss.sheet_id });
      applyLocationText(iss, loc, iss.sheet_id);
    }
  }

  // Ensure every issue has a location_label even without linked items
  for (const iss of legacyIssues) {
    if (iss.location_label || iss.raw_description !== undefined) continue;
    const ref = Array.isArray(iss.source_refs) ? iss.source_refs[0] : null;
    const loc = extractLocationFromRef(ref, {}, { sheet_id: iss.sheet_id });
    applyLocationText(iss, loc, iss.sheet_id);
  }

  // Canonical issues: enrich location from takeoff_items, then prefix
  await enrichCanonicalIssueLocations(canonicalIssues);
  for (const iss of canonicalIssues) {
    applyLocationText(iss, iss.location, null);
    if (!iss.location_label && iss.sheet_id) iss.location_label = `Item ${String(iss.sheet_id).slice(0, 8)}`;
  }

  // Drop legacy questions whose answer is already in the linked row.
  // The estimator commonly asks for "rebar callout" / "element dimensions"
  // even after the OCR excerpt or row already contains them. Surfacing
  // these wastes the engineer's time and points the overlay nowhere useful.
  const filteredLegacy = legacyIssues.filter((iss) => !legacyIssueAlreadyAnswered(iss));
  return [...filteredLegacy, ...canonicalIssues];
}

// Returns true when the issue's missing_refs are already satisfied by data
// present on the linked estimate row (callout in excerpt, length resolved, etc.).
function legacyIssueAlreadyAnswered(iss: WorkflowQaIssue): boolean {
  const li = iss.linked_item;
  if (!li) return false;
  // If the deterministic resolver (or the model itself) tied this row back
  // to a schedule entry on the drawings, treat the question as answered:
  // dimensions/callouts come from the schedule mark, not from the engineer.
  const refs = Array.isArray(iss.source_refs) ? iss.source_refs[0] : null;
  const aj = (refs && typeof refs === "object" ? (refs as any).assumptions_json : null) || null;
  const scheduleMark = (li as any).schedule_mark
    || (refs as any)?.schedule_mark
    || aj?.schedule_mark
    || null;
  if (scheduleMark) return true;
  const missing = (li.missing_refs || []).map((m) => String(m).toLowerCase().trim()).filter(Boolean);
  if (missing.length === 0) return false;
  const excerpt = String(iss.location?.source_excerpt || iss.description || "").toLowerCase();
  const rawDescription = String(iss.raw_description || "").toLowerCase();
  const haystack = `${excerpt} ${rawDescription} ${String(li.description || "").toLowerCase()}`;
  // Callout patterns: "15M x 457mm", "10M @ 300mm", "(2) 20M", "10M VERTICAL"
  const calloutRx = /\b\d{1,2}m\s*(?:x|×|@|cont|vert|horiz|long|bars?|u\.n\.o)/i;
  const dimRx = /\b\d{2,5}\s*mm\b|\b\d+(?:\.\d+)?\s*m\b/i;
  const hasCallout = Boolean(li.bar_size) && calloutRx.test(haystack);
  const hasDim = (Number(li.total_length) || 0) > 0 || dimRx.test(haystack);
  const stillMissing = missing.filter((tok) => {
    if (/callout|mark|rebar/.test(tok) && hasCallout) return false;
    if (/dimension|length|height|width|geometry|run|perimeter/.test(tok) && hasDim) return false;
    return true;
  });
  return stillMissing.length === 0;
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
