import React from "react";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";

export interface SearchFilterValues {
  discipline?: string;
  drawing_type?: string;
  revision?: string;
  bar_mark?: string;
  sort?: string;
  min_confidence?: number;
  needs_review?: string;
  revision_chain_id?: string;
}

const DISCIPLINES = ["structural", "architectural", "mechanical", "electrical"];
const DRAWING_TYPES = ["plan", "detail", "section", "elevation", "schedule", "foundation_plan", "rebar_plan"];
const SORT_OPTIONS = [
  { value: "relevance", label: "Relevance" },
  { value: "date", label: "Date" },
  { value: "sheet", label: "Sheet ID" },
  { value: "confidence", label: "Confidence" },
];

interface Props {
  filters: SearchFilterValues;
  onChange: (filters: SearchFilterValues) => void;
}

const SearchFilters: React.FC<Props> = ({ filters, onChange }) => {
  const toggle = (key: keyof SearchFilterValues, value: string) => {
    onChange({ ...filters, [key]: filters[key] === value ? undefined : value });
  };

  const activeCount = Object.entries(filters).filter(([k, v]) => v !== undefined && k !== "sort" && k !== "min_confidence").length;

  return (
    <div className="space-y-2">
      {activeCount > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Active:</span>
          {Object.entries(filters).map(([key, val]) =>
            val !== undefined && key !== "sort" && key !== "min_confidence" ? (
              <Badge key={key} variant="secondary" className="text-[10px] gap-1 cursor-pointer" onClick={() => onChange({ ...filters, [key]: undefined })}>
                {String(val)}
                <X className="h-2.5 w-2.5" />
              </Badge>
            ) : null
          )}
        </div>
      )}

      {/* Sort */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Sort:</span>
        <Select value={filters.sort || "relevance"} onValueChange={(v) => onChange({ ...filters, sort: v })}>
          <SelectTrigger className="h-7 text-[11px] w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className="text-[11px]">{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Confidence threshold */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Min Confidence</span>
          <span className="text-[10px] font-mono text-muted-foreground">{((filters.min_confidence ?? 0) * 100).toFixed(0)}%</span>
        </div>
        <Slider
          value={[filters.min_confidence ?? 0]}
          onValueChange={([v]) => onChange({ ...filters, min_confidence: v })}
          min={0}
          max={1}
          step={0.1}
          className="w-full"
        />
      </div>

      {/* Needs review toggle */}
      <div className="flex items-center gap-2">
        <Badge
          variant={filters.needs_review === "true" ? "default" : "outline"}
          className="text-[10px] cursor-pointer"
          onClick={() => toggle("needs_review", "true")}
        >
          ⚠ Needs Review Only
        </Badge>
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Discipline</p>
        <div className="flex flex-wrap gap-1">
          {DISCIPLINES.map((d) => (
            <Badge
              key={d}
              variant={filters.discipline === d ? "default" : "outline"}
              className="text-[10px] cursor-pointer capitalize"
              onClick={() => toggle("discipline", d)}
            >
              {d}
            </Badge>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Drawing Type</p>
        <div className="flex flex-wrap gap-1">
          {DRAWING_TYPES.map((dt) => (
            <Badge
              key={dt}
              variant={filters.drawing_type === dt ? "default" : "outline"}
              className="text-[10px] cursor-pointer capitalize"
              onClick={() => toggle("drawing_type", dt)}
            >
              {dt.replace(/_/g, " ")}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SearchFilters;
