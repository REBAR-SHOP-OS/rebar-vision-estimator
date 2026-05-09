// Map a free-form scope label to one of the allowed segment_type values
// used by the takeoff engine. Defaults to "miscellaneous" only when no
// pattern matches.
export function inferSegmentType(label: string): string {
  const n = (label || "").toLowerCase();
  if (/(retain|retaining)/.test(n)) return "retaining_wall";
  if (/(wall|frost wall|foundation wall)/.test(n)) return "wall";
  if (/(footing|ftg|pile cap|pile|caisson|grade beam|raft|mat)/.test(n)) return "footing";
  if (/(slab|sog|slab[- ]on[- ]grade|topping|deck)/.test(n)) return "slab";
  if (/(beam|girder|joist|lintel|bond beam)/.test(n)) return "beam";
  if (/(column|col\b)/.test(n)) return "column";
  if (/(pier)/.test(n)) return "pier";
  if (/(stair)/.test(n)) return "stair";
  if (/(pit|sump|elevator pit)/.test(n)) return "pit";
  if (/(curb|stoop|ledge|housekeeping pad|equipment pad)/.test(n)) return "curb";
  return "miscellaneous";
}

// Stable color per segment type — Togal-style palette.
const TYPE_COLORS: Record<string, string> = {
  footing: "hsl(140 60% 45%)",
  wall: "hsl(220 70% 55%)",
  retaining_wall: "hsl(265 60% 55%)",
  slab: "hsl(180 60% 45%)",
  beam: "hsl(45 90% 50%)",
  column: "hsl(280 65% 55%)",
  pier: "hsl(330 70% 55%)",
  stair: "hsl(20 80% 55%)",
  pit: "hsl(200 60% 45%)",
  curb: "hsl(160 50% 45%)",
  miscellaneous: "hsl(0 0% 55%)",
};

export function colorForSegmentType(type: string | null | undefined): string {
  return TYPE_COLORS[(type || "miscellaneous").toLowerCase()] || TYPE_COLORS.miscellaneous;
}