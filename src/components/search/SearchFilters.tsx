import React from "react";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";

export interface SearchFilterValues {
  discipline?: string;
  drawing_type?: string;
  revision?: string;
  bar_mark?: string;
}

const DISCIPLINES = ["structural", "architectural", "mechanical", "electrical"];
const DRAWING_TYPES = ["plan", "detail", "section", "elevation", "schedule", "foundation_plan", "rebar_plan"];

interface Props {
  filters: SearchFilterValues;
  onChange: (filters: SearchFilterValues) => void;
}

const SearchFilters: React.FC<Props> = ({ filters, onChange }) => {
  const toggle = (key: keyof SearchFilterValues, value: string) => {
    onChange({ ...filters, [key]: filters[key] === value ? undefined : value });
  };

  const activeCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="space-y-2">
      {activeCount > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Active:</span>
          {Object.entries(filters).map(([key, val]) =>
            val ? (
              <Badge key={key} variant="secondary" className="text-[10px] gap-1 cursor-pointer" onClick={() => onChange({ ...filters, [key]: undefined })}>
                {val}
                <X className="h-2.5 w-2.5" />
              </Badge>
            ) : null
          )}
        </div>
      )}
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
