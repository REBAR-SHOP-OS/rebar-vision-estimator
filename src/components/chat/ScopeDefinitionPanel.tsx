import React, { useState, useEffect } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, Info, Sparkles, AlertTriangle } from "lucide-react";

const SCOPE_ITEMS = [
  { id: "FOOTING", label: "Footings", category: "Foundation" },
  { id: "GRADE_BEAM", label: "Grade Beams", category: "Foundation" },
  { id: "RAFT_SLAB", label: "Raft Slabs", category: "Foundation" },
  { id: "PIER", label: "Piers / Pedestals", category: "Foundation" },
  { id: "BEAM", label: "Beams", category: "Structural" },
  { id: "COLUMN", label: "Columns", category: "Structural" },
  { id: "SLAB", label: "Slabs", category: "Structural" },
  { id: "STAIR", label: "Stairs", category: "Structural" },
  { id: "WALL", label: "Walls", category: "Walls" },
  { id: "RETAINING_WALL", label: "Retaining Walls", category: "Walls" },
  { id: "ICF_WALL", label: "ICF Walls", category: "Walls" },
  { id: "CMU_WALL", label: "CMU Walls", category: "Walls" },
  { id: "WIRE_MESH", label: "Wire Mesh", category: "Other" },
] as const;

const REBAR_COATING_TYPES = [
  { id: "black_steel", label: "Black Steel (Standard)" },
  { id: "epoxy_coated", label: "Epoxy-Coated" },
  { id: "galvanized", label: "Galvanized" },
  { id: "stainless_steel", label: "Stainless Steel" },
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  cage: "Cage Project",
  industrial: "Industrial",
  residential: "Residential",
  commercial: "Commercial",
  bar_list: "Bar List",
  infrastructure: "Infrastructure",
};

const STANDARD_LABELS: Record<string, string> = {
  canadian_metric: "Canadian Metric (CSA/RSIC)",
  us_imperial: "US Imperial (ACI)",
  unknown: "Unknown",
};

export interface ScopeData {
  scopeItems: string[];
  clientName: string;
  projectType: string;
  deviations: string;
  rebarCoating: string;
  detectedCategory?: string;
  detectedStandard?: string;
}

export interface DetectionResult {
  category: string;
  recommendedScope: string[];
  detectedStandard: string;
  confidence: number;
  reasoning: string;
}

interface ScopeDefinitionPanelProps {
  onProceed: (scope: ScopeData) => void;
  disabled?: boolean;
  detectionResult?: DetectionResult | null;
  isDetecting?: boolean;
}

const ScopeDefinitionPanel: React.FC<ScopeDefinitionPanelProps> = ({ onProceed, disabled, detectionResult, isDetecting }) => {
  const [selectedItems, setSelectedItems] = useState<string[]>(SCOPE_ITEMS.map((s) => s.id));
  const [clientName, setClientName] = useState("");
  const [projectType, setProjectType] = useState("");
  const [deviations, setDeviations] = useState("");
  const [rebarCoating, setRebarCoating] = useState("black_steel");

  // Apply detection results when they arrive
  useEffect(() => {
    if (detectionResult) {
      if (detectionResult.recommendedScope && detectionResult.recommendedScope.length > 0) {
        setSelectedItems(detectionResult.recommendedScope);
      }
      if (detectionResult.category) {
        setProjectType(detectionResult.category);
      }
    }
  }, [detectionResult]);

  const toggleItem = (id: string) => {
    setSelectedItems((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    if (selectedItems.length === SCOPE_ITEMS.length) {
      setSelectedItems([]);
    } else {
      setSelectedItems(SCOPE_ITEMS.map((s) => s.id));
    }
  };

  const handleProceed = () => {
    if (selectedItems.length === 0) return;
    onProceed({
      scopeItems: selectedItems,
      clientName,
      projectType,
      deviations,
      rebarCoating,
      detectedCategory: detectionResult?.category,
      detectedStandard: detectionResult?.detectedStandard,
    });
  };

  const categories = SCOPE_ITEMS.reduce<Record<string, typeof SCOPE_ITEMS[number][]>>((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});

  return (
    <div className="rounded-xl border-2 border-primary/20 bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-border bg-primary/5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">2</div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Define Takeoff Scope</h3>
          <p className="text-xs text-muted-foreground">Select elements and project details</p>
        </div>
      </div>

      <div className="p-4 space-y-5">
        {/* Detection Banner */}
        {isDetecting && (
          <div className="flex items-center gap-3 rounded-lg bg-primary/10 border border-primary/20 p-3 animate-pulse">
            <Sparkles className="h-4 w-4 text-primary flex-shrink-0 animate-spin" />
            <p className="text-xs text-primary font-medium">Analyzing blueprints to detect project type...</p>
          </div>
        )}

        {detectionResult && detectionResult.confidence > 0 && (
          <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 space-y-2">
            <div className="flex items-start gap-2">
              <Sparkles className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-xs font-semibold text-foreground">
                  Detected: <span className="text-primary">{CATEGORY_LABELS[detectionResult.category] || detectionResult.category}</span>
                  {detectionResult.detectedStandard !== "unknown" && (
                    <span className="text-muted-foreground font-normal"> — {STANDARD_LABELS[detectionResult.detectedStandard]}</span>
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{detectionResult.reasoning}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${Math.round(detectionResult.confidence * 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground font-medium">{Math.round(detectionResult.confidence * 100)}% confidence</span>
                </div>
              </div>
            </div>
            {/* Category-specific guidance */}
            {detectionResult.category === "cage" && (
              <div className="flex items-start gap-2 rounded-md bg-accent/50 p-2 mt-1">
                <Info className="h-3.5 w-3.5 text-primary flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-muted-foreground">Cage project — estimator will focus on cage assemblies (verticals, ties, spirals, cage marks).</p>
              </div>
            )}
            {detectionResult.category === "bar_list" && (
              <div className="flex items-start gap-2 rounded-md bg-accent/50 p-2 mt-1">
                <Info className="h-3.5 w-3.5 text-primary flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-muted-foreground">Bar list detected — will parse schedule tables directly for bar marks, sizes, quantities, and lengths.</p>
              </div>
            )}
            {detectionResult.detectedStandard === "canadian_metric" && (
              <div className="flex items-start gap-2 rounded-md bg-accent/50 p-2 mt-1">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-muted-foreground">Canadian metric detected — RSIC standard practice rules will be applied automatically.</p>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground italic">Scope adjusted automatically. You can still modify selections below.</p>
          </div>
        )}

        {/* Info Box */}
        {!detectionResult && !isDetecting && (
          <div className="flex items-start gap-2 rounded-lg bg-primary/5 border border-primary/15 p-3">
            <Info className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Select the element types present in your blueprint. The AI will focus on these items during estimation.
            </p>
          </div>
        )}

        {/* Element Types by Category */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <Label className="text-xs font-semibold text-foreground uppercase tracking-wider">Element Types</Label>
            <button type="button" onClick={toggleAll} className="text-xs text-primary hover:underline font-medium">
              {selectedItems.length === SCOPE_ITEMS.length ? "Deselect All" : "Select All"}
            </button>
          </div>
          <div className="space-y-3">
            {Object.entries(categories).map(([cat, items]) => (
              <div key={cat}>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5 px-1">{cat}</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {items.map((item) => (
                    <label
                      key={item.id}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs cursor-pointer transition-all ${
                        selectedItems.includes(item.id)
                          ? "border-primary/40 bg-primary/5 text-foreground"
                          : "border-border hover:bg-accent/50 text-muted-foreground"
                      }`}
                    >
                      <Checkbox
                        checked={selectedItems.includes(item.id)}
                        onCheckedChange={() => toggleItem(item.id)}
                        className="h-3.5 w-3.5"
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Rebar Coating */}
        <div>
          <Label className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2 block">Rebar Coating</Label>
          <div className="grid grid-cols-2 gap-1.5">
            {REBAR_COATING_TYPES.map((coating) => (
              <label
                key={coating.id}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs cursor-pointer transition-all ${
                  rebarCoating === coating.id
                    ? "border-primary/40 bg-primary/5 text-foreground"
                    : "border-border hover:bg-accent/50 text-muted-foreground"
                }`}
              >
                <Checkbox
                  checked={rebarCoating === coating.id}
                  onCheckedChange={() => setRebarCoating(coating.id)}
                  className="h-3.5 w-3.5"
                />
                <span>{coating.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Project Details */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="clientName" className="text-xs text-muted-foreground mb-1 block">Client Name</Label>
            <Input
              id="clientName"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. ABC Construction"
              className="h-9 text-xs rounded-lg"
            />
          </div>
          <div>
            <Label htmlFor="projectType" className="text-xs text-muted-foreground mb-1 block">Project Type</Label>
            <Select value={projectType} onValueChange={setProjectType}>
              <SelectTrigger className="h-9 text-xs rounded-lg">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cage">Cage</SelectItem>
                <SelectItem value="commercial">Commercial</SelectItem>
                <SelectItem value="residential">Residential</SelectItem>
                <SelectItem value="industrial">Industrial</SelectItem>
                <SelectItem value="infrastructure">Infrastructure</SelectItem>
                <SelectItem value="bar_list">Bar List</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Deviations */}
        <div>
          <Label htmlFor="deviations" className="text-xs text-muted-foreground mb-1 block">Project Notes / Deviations</Label>
          <Textarea
            id="deviations"
            value={deviations}
            onChange={(e) => setDeviations(e.target.value)}
            placeholder="Any special notes, exclusions, or deviations from standard practice..."
            className="text-xs min-h-[50px] rounded-lg"
            rows={2}
          />
        </div>

        {/* Proceed Button */}
        <Button
          onClick={handleProceed}
          disabled={disabled || selectedItems.length === 0 || isDetecting}
          className="w-full gap-2 h-10 rounded-xl font-semibold"
        >
          Proceed with {selectedItems.length} element type{selectedItems.length !== 1 ? "s" : ""}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default ScopeDefinitionPanel;
