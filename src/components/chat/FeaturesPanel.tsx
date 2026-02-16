import React, { useState } from "react";
import { Search, Eye, EyeOff, ChevronRight, PanelLeftClose, CheckCircle2, XCircle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ELEMENT_TYPE_COLORS, type OverlayElement, type ReviewStatus } from "./DrawingOverlay";

interface FeaturesPanelProps {
  elements: OverlayElement[];
  selectedElementId: string | null;
  onSelectElement: (id: string | null) => void;
  visibleTypes: Set<string>;
  onToggleType: (type: string) => void;
  onClose: () => void;
  reviewStatuses?: Map<string, ReviewStatus>;
}

const FeaturesPanel: React.FC<FeaturesPanelProps> = ({
  elements,
  selectedElementId,
  onSelectElement,
  visibleTypes,
  onToggleType,
  onClose,
  reviewStatuses,
}) => {
  const [search, setSearch] = useState("");
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(
    [...new Set(elements.map((e) => e.element_type))]
  ));

  const toggleGroup = (type: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  // Group elements by type
  const typeGroups = elements.reduce<Record<string, OverlayElement[]>>((acc, el) => {
    if (!acc[el.element_type]) acc[el.element_type] = [];
    acc[el.element_type].push(el);
    return acc;
  }, {});

  const types = Object.keys(typeGroups).sort();
  const searchLower = search.toLowerCase();

  return (
    <div className="w-[260px] flex-shrink-0 bg-card border-r border-border flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <h3 className="text-sm font-bold text-foreground tracking-tight">Features</h3>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <PanelLeftClose className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search elements..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 pl-7 text-xs bg-muted/50 border-border"
          />
        </div>
      </div>

      {/* Element Groups */}
      <ScrollArea className="flex-1">
        <div className="py-1">
          {types.map((type) => {
            const color = ELEMENT_TYPE_COLORS[type] || ELEMENT_TYPE_COLORS.OTHER;
            const groupElements = typeGroups[type];
            const filteredElements = search
              ? groupElements.filter((el) => el.element_id.toLowerCase().includes(searchLower))
              : groupElements;
            const isVisible = visibleTypes.has(type);
            const isOpen = openGroups.has(type);

            if (search && filteredElements.length === 0) return null;

            return (
              <Collapsible
                key={type}
                open={isOpen}
                onOpenChange={() => toggleGroup(type)}
              >
                <div className="flex items-center gap-1 px-2 py-1 hover:bg-muted/50 transition-colors group">
                  <CollapsibleTrigger asChild>
                    <button className="flex items-center gap-1.5 flex-1 min-w-0 text-left">
                      <ChevronRight
                        className="h-3 w-3 text-muted-foreground transition-transform flex-shrink-0"
                        style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
                      />
                      <span
                        className="w-3 h-3 rounded-sm flex-shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-xs font-semibold text-foreground truncate">
                        {type}
                      </span>
                      <Badge
                        variant="secondary"
                        className="h-4 px-1.5 text-[9px] font-bold ml-auto flex-shrink-0"
                        style={{ backgroundColor: `${color}20`, color }}
                      >
                        {groupElements.length}
                      </Badge>
                    </button>
                  </CollapsibleTrigger>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleType(type);
                    }}
                    className="p-0.5 rounded hover:bg-muted transition-colors flex-shrink-0 opacity-60 hover:opacity-100"
                    title={isVisible ? "Hide type" : "Show type"}
                  >
                    {isVisible ? (
                      <Eye className="h-3 w-3 text-muted-foreground" />
                    ) : (
                      <EyeOff className="h-3 w-3 text-muted-foreground" />
                    )}
                  </button>
                </div>

                <CollapsibleContent>
                  <div className="ml-4 border-l-2 border-border/50">
                    {filteredElements.map((el) => {
                      const isSelected = el.element_id === selectedElementId;
                      const reviewStatus = reviewStatuses?.get(el.element_id);

                      return (
                        <button
                          key={el.element_id}
                          onClick={() => onSelectElement(el.element_id)}
                          className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-all hover:bg-muted/60 ${
                            isSelected ? "bg-accent/50" : ""
                          }`}
                          style={isSelected ? { 
                            backgroundColor: `${color}15`,
                            borderRight: `2px solid ${color}`,
                          } : undefined}
                        >
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          <span className={`text-[11px] truncate ${isSelected ? "font-bold text-foreground" : "text-muted-foreground"}`}>
                            {el.element_id}
                          </span>
                          {el.confidence !== undefined && (
                            <span className="text-[9px] text-muted-foreground ml-auto flex-shrink-0">
                              {Math.round(el.confidence * 100)}%
                            </span>
                          )}
                          {reviewStatus === "confirmed" && (
                            <CheckCircle2 className="h-3 w-3 text-green-500 flex-shrink-0 ml-auto" />
                          )}
                          {reviewStatus === "rejected" && (
                            <XCircle className="h-3 w-3 text-red-500 flex-shrink-0 ml-auto" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      </ScrollArea>

      {/* Footer summary */}
      <div className="px-3 py-2 border-t border-border bg-muted/30">
        <p className="text-[10px] text-muted-foreground">
          {elements.length} elements · {types.length} types
        </p>
      </div>
    </div>
  );
};

export default FeaturesPanel;
