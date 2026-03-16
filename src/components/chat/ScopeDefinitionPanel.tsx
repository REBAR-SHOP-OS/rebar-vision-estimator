import React, { useState, useEffect } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, Info, Sparkles, AlertTriangle, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export const SCOPE_ITEMS = [
  // Bucket 1 — Substructure & Deep Foundations
  { id: "PILE", label: "Piles", category: "Substructure & Deep Foundations" },
  { id: "CAISSON", label: "Caissons / Drilled Piers", category: "Substructure & Deep Foundations" },
  { id: "GRADE_BEAM", label: "Grade Beams", category: "Substructure & Deep Foundations" },
  { id: "FOOTING", label: "Footings", category: "Substructure & Deep Foundations" },
  { id: "RAFT_SLAB", label: "Raft Slabs", category: "Substructure & Deep Foundations" },
  { id: "PIER", label: "Piers / Pedestals", category: "Substructure & Deep Foundations" },
  { id: "ELEVATOR_PIT", label: "Elevator Pits", category: "Substructure & Deep Foundations" },
  { id: "SUMP_PIT", label: "Sump Pits", category: "Substructure & Deep Foundations" },
  // Bucket 2 — Slab-on-Grade & Flatwork
  { id: "SLAB_ON_GRADE", label: "Slab-on-Grade", category: "Slab-on-Grade & Flatwork" },
  { id: "THICKENED_EDGE", label: "Thickened Edges", category: "Slab-on-Grade & Flatwork" },
  { id: "TRENCH_DRAIN", label: "Trench Drains", category: "Slab-on-Grade & Flatwork" },
  { id: "EQUIPMENT_PAD", label: "Equipment Pads", category: "Slab-on-Grade & Flatwork" },
  { id: "WIRE_MESH", label: "Wire Mesh", category: "Slab-on-Grade & Flatwork" },
  // Bucket 3 — Superstructure
  { id: "COLUMN", label: "Columns", category: "Superstructure" },
  { id: "BEAM", label: "Beams", category: "Superstructure" },
  { id: "ELEVATED_SLAB", label: "Elevated / Suspended Slabs", category: "Superstructure" },
  { id: "STAIR", label: "Stairs", category: "Superstructure" },
  { id: "SHEAR_WALL", label: "Shear Walls", category: "Superstructure" },
  { id: "CAGE", label: "Cage Assemblies", category: "Superstructure" },
  // Bucket 4 — Masonry / CMU
  { id: "CMU_WALL", label: "CMU Walls", category: "Masonry / CMU" },
  { id: "BOND_BEAM", label: "Bond Beams", category: "Masonry / CMU" },
  { id: "MASONRY_DOWEL", label: "Masonry Dowels", category: "Masonry / CMU" },
  // Bucket 5 — Site, Civil & Landscape
  { id: "RETAINING_WALL", label: "Retaining Walls", category: "Site, Civil & Landscape" },
  { id: "ICF_WALL", label: "ICF Walls", category: "Site, Civil & Landscape" },
  { id: "LIGHT_POLE_BASE", label: "Light Pole Bases", category: "Site, Civil & Landscape" },
  { id: "TRANSFORMER_PAD", label: "Transformer Pads", category: "Site, Civil & Landscape" },
  { id: "SITE_PAVING", label: "Site Paving / Driveways", category: "Site, Civil & Landscape" },
] as const;

// Legacy ID mapping for backward compatibility with saved projects
const LEGACY_ID_MAP: Record<string, string> = {
  SLAB: "SLAB_ON_GRADE",
  WALL: "SHEAR_WALL",
};

const REBAR_COATING_TYPES = [
  { id: "black_steel", label: "Black Steel (Standard)" },
  { id: "epoxy_coated", label: "Epoxy-Coated" },
  { id: "galvanized", label: "Galvanized" },
  { id: "stainless_steel", label: "Stainless Steel" },
] as const;

const PRIMARY_CATEGORY_LABELS: Record<string, string> = {
  cage_only: "Cage Only",
  bar_list_only: "Bar List Only",
  residential: "Residential",
  commercial: "Commercial",
  industrial: "Industrial",
  infrastructure: "Infrastructure",
  // Legacy mapping
  cage: "Cage Project",
  bar_list: "Bar List",
};

const STANDARD_LABELS: Record<string, string> = {
  canadian_metric: "Canadian Metric (CSA/RSIC)",
  us_imperial: "US Imperial (ACI)",
  unknown: "Unknown",
};

// Scope items locked for cage_only projects
const CAGE_ONLY_SCOPE = ["CAGE", "COLUMN", "PIER", "CAISSON"];
// Recommended scope for residential
const RESIDENTIAL_SCOPE = ["FOOTING", "GRADE_BEAM", "SLAB_ON_GRADE", "THICKENED_EDGE", "WIRE_MESH", "ICF_WALL", "CMU_WALL", "STAIR", "CAGE"];

export interface ScopeData {
  scopeItems: string[];
  clientName: string;
  projectType: string;
  deviations: string;
  rebarCoating: string;
  detectedCategory?: string;
  detectedStandard?: string;
  // V2 fields
  primaryCategory?: string;
  features?: { hasCageAssembly: boolean; hasBarListTable: boolean };
}

// V2 detection result with backward compatibility
export interface DetectionResult {
  // V2 fields
  primaryCategory?: string;
  features?: { hasCageAssembly: boolean; hasBarListTable: boolean };
  evidence?: { buildingSignals: string[]; cageSignals: string[]; barListSignals: string[] };
  confidencePrimary?: number;
  detectedCoating?: string;
  disciplinesFound?: { discipline: string; sheetsIdentified?: string[]; scopeContributions: string[] }[];
  hiddenScope?: string[];
  // Legacy fields (backward compat)
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
  scopeSourceType?: string | null;
}

// Helper to normalize detection result to V2 format
function normalizeDetection(d: DetectionResult): DetectionResult & { primaryCategory: string; features: { hasCageAssembly: boolean; hasBarListTable: boolean } } {
  const primaryCategory = d.primaryCategory || (d.category === "cage" ? "cage_only" : d.category === "bar_list" ? "bar_list_only" : d.category);
  const features = d.features || {
    hasCageAssembly: d.category === "cage" || primaryCategory === "cage_only",
    hasBarListTable: d.category === "bar_list" || primaryCategory === "bar_list_only",
  };
  return { ...d, primaryCategory, features };
}

// Exported utility: build ScopeData from a DetectionResult without user interaction
export function buildScopeFromDetection(d: DetectionResult): ScopeData {
  const n = normalizeDetection(d);
  const isCage = n.primaryCategory === "cage_only";
  const isBarList = n.primaryCategory === "bar_list_only";

  let scopeItems: string[];
  if (isCage) {
    scopeItems = [...CAGE_ONLY_SCOPE];
  } else if (isBarList) {
    scopeItems = [];
  } else {
    // Always include all elements — the AI will extract what it finds
    scopeItems = SCOPE_ITEMS.map((s) => s.id);
  }

  const typeMap: Record<string, string> = {
    cage_only: "cage", bar_list_only: "bar_list",
    residential: "residential", commercial: "commercial",
    industrial: "industrial", infrastructure: "infrastructure",
  };

  const coatingMap: Record<string, string> = {
    EPOXY: "epoxy_coated", GALVANISED: "galvanized", STAINLESS: "stainless_steel",
  };

  return {
    scopeItems,
    clientName: "",
    projectType: typeMap[n.primaryCategory] || n.primaryCategory,
    deviations: "",
    rebarCoating: (n.detectedCoating && coatingMap[n.detectedCoating]) || "black_steel",
    detectedCategory: n.category,
    detectedStandard: n.detectedStandard,
    primaryCategory: n.primaryCategory,
    features: {
      hasCageAssembly: isCage || !!n.features?.hasCageAssembly,
      hasBarListTable: isBarList || !!n.features?.hasBarListTable,
    },
  };
}

const ScopeDefinitionPanel: React.FC<ScopeDefinitionPanelProps> = ({ onProceed, disabled, detectionResult, isDetecting, scopeSourceType }) => {
  const [selectedItems, setSelectedItems] = useState<string[]>(SCOPE_ITEMS.map((s) => s.id));
  const [clientName, setClientName] = useState("");
  const [projectType, setProjectType] = useState("");
  const [deviations, setDeviations] = useState("");
  const [rebarCoating, setRebarCoating] = useState("black_steel");
  const [includeCageModule, setIncludeCageModule] = useState(true);
  const [scopeLocked, setScopeLocked] = useState(false);

  const normalized = detectionResult ? normalizeDetection(detectionResult) : null;
  const isCageOnly = normalized?.primaryCategory === "cage_only";
  const isBarListOnly = normalized?.primaryCategory === "bar_list_only";

  // Apply detection results when they arrive
  useEffect(() => {
    if (!normalized) return;

    if (isCageOnly) {
      setSelectedItems(CAGE_ONLY_SCOPE);
      setScopeLocked(true);
    } else if (isBarListOnly) {
      setSelectedItems([]);
      setScopeLocked(true);
    } else {
      // Always keep all items selected for general categories
      setSelectedItems(SCOPE_ITEMS.map((s) => s.id));
      setScopeLocked(false);
    }

    if (normalized.primaryCategory) {
      // Map V2 primaryCategory back to project type dropdown value
      const typeMap: Record<string, string> = {
        cage_only: "cage", bar_list_only: "bar_list",
        residential: "residential", commercial: "commercial",
        industrial: "industrial", infrastructure: "infrastructure",
      };
      setProjectType(typeMap[normalized.primaryCategory] || normalized.primaryCategory);
    }

    if (normalized.features?.hasCageAssembly && !isCageOnly) {
      setIncludeCageModule(true);
    }

    // Auto-detect coating
    const coatingMap: Record<string, string> = {
      EPOXY: "epoxy_coated", GALVANISED: "galvanized", STAINLESS: "stainless_steel",
    };
    if (normalized.detectedCoating && coatingMap[normalized.detectedCoating]) {
      setRebarCoating(coatingMap[normalized.detectedCoating]);
    }
  }, [detectionResult]);

  const toggleItem = (id: string) => {
    if (scopeLocked) return;
    setSelectedItems((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    if (scopeLocked) return;
    if (selectedItems.length === SCOPE_ITEMS.length) {
      setSelectedItems([]);
    } else {
      setSelectedItems(SCOPE_ITEMS.map((s) => s.id));
    }
  };

  const resetToAll = () => {
    setScopeLocked(false);
    setSelectedItems(SCOPE_ITEMS.map((s) => s.id));
  };

  const handleProceed = () => {
    if (selectedItems.length === 0 && !isBarListOnly) return;
    onProceed({
      scopeItems: selectedItems,
      clientName,
      projectType,
      deviations,
      rebarCoating,
      detectedCategory: normalized?.category,
      detectedStandard: normalized?.detectedStandard,
      primaryCategory: normalized?.primaryCategory,
      features: {
        hasCageAssembly: isCageOnly || (includeCageModule && !!normalized?.features?.hasCageAssembly),
        hasBarListTable: isBarListOnly || !!normalized?.features?.hasBarListTable,
      },
    });
  };

  const categories = SCOPE_ITEMS.reduce<Record<string, typeof SCOPE_ITEMS[number][]>>((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});

  const effectiveConfidence = normalized?.confidencePrimary ?? normalized?.confidence ?? 0;
  const showCageToggle = !isCageOnly && !isBarListOnly && normalized?.features?.hasCageAssembly;

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
        {/* No Scope Warning */}
        {scopeSourceType === "none" && !isDetecting && (
          <div className="flex items-center gap-3 rounded-lg bg-amber-500/10 border border-amber-500/30 p-3">
            <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-xs font-medium text-amber-600 dark:text-amber-400">No scope detected</p>
              <p className="text-[10px] text-muted-foreground">Upload drawings for automatic scope extraction. Estimation blocked until scope is available.</p>
            </div>
            <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-600 dark:text-amber-400">No Scope</Badge>
          </div>
        )}
        {/* Detection Banner */}
        {isDetecting && (
          <div className="flex items-center gap-3 rounded-lg bg-primary/10 border border-primary/20 p-3 animate-pulse">
            <Sparkles className="h-4 w-4 text-primary flex-shrink-0 animate-spin" />
            <p className="text-xs text-primary font-medium">Analyzing blueprints to detect project type...</p>
          </div>
        )}

        {normalized && effectiveConfidence > 0 && (
          <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 space-y-2">
            <div className="flex items-start gap-2">
              <Sparkles className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-xs font-semibold text-foreground">
                    Detected: <span className="text-primary">{PRIMARY_CATEGORY_LABELS[normalized.primaryCategory] || normalized.primaryCategory}</span>
                  </p>
                  {/* Feature badges */}
                  {normalized.features?.hasCageAssembly && !isCageOnly && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-orange-400/50 text-orange-600 dark:text-orange-400">
                      + Cage Assembly
                    </Badge>
                  )}
                  {normalized.features?.hasBarListTable && !isBarListOnly && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-400/50 text-blue-600 dark:text-blue-400">
                      + Bar List
                    </Badge>
                  )}
                </div>
                {normalized.detectedStandard !== "unknown" && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">{STANDARD_LABELS[normalized.detectedStandard]}</p>
                )}
                <p className="text-[11px] text-muted-foreground mt-0.5">{normalized.reasoning}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${Math.round(effectiveConfidence * 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground font-medium">{Math.round(effectiveConfidence * 100)}% confidence</span>
                </div>
              </div>
            </div>

            {/* Category-specific guidance */}
            {isCageOnly && (
              <div className="flex items-start gap-2 rounded-md bg-accent/50 p-2 mt-1">
                <Info className="h-3.5 w-3.5 text-primary flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-muted-foreground">Cage-only project — scope locked to cage assemblies (verticals, ties, spirals).</p>
              </div>
            )}
            {isBarListOnly && (
              <div className="flex items-start gap-2 rounded-md bg-accent/50 p-2 mt-1">
                <Info className="h-3.5 w-3.5 text-primary flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-muted-foreground">Bar list detected — will parse schedule tables directly for bar marks, sizes, quantities, and lengths.</p>
              </div>
            )}
            {normalized.detectedStandard === "canadian_metric" && (
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

        {/* Cage Assembly Toggle (for non-cage_only projects with cage content) */}
        {showCageToggle && (
          <div className="flex items-center gap-3 rounded-lg border border-orange-400/30 bg-orange-50/50 dark:bg-orange-950/20 p-3">
            <Checkbox
              checked={includeCageModule}
              onCheckedChange={(checked) => setIncludeCageModule(!!checked)}
              className="h-4 w-4"
            />
            <div className="flex-1">
              <p className="text-xs font-semibold text-foreground">Include Cage Assembly module</p>
              <p className="text-[10px] text-muted-foreground">Cage/caisson details detected. Process cage assemblies alongside main estimation.</p>
            </div>
          </div>
        )}

        {/* Element Types by Category */}
        {!isBarListOnly && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <Label className="text-xs font-semibold text-foreground uppercase tracking-wider">Element Types</Label>
              <div className="flex items-center gap-3">
                {scopeLocked && (
                  <button type="button" onClick={resetToAll} className="flex items-center gap-1 text-xs text-primary hover:underline font-medium">
                    <RotateCcw className="h-3 w-3" />
                    Reset to all
                  </button>
                )}
                {!scopeLocked && (
                  <button type="button" onClick={toggleAll} className="text-xs text-primary hover:underline font-medium">
                    {selectedItems.length === SCOPE_ITEMS.length ? "Deselect All" : "Select All"}
                  </button>
                )}
              </div>
            </div>
            <div className="space-y-3">
              {Object.entries(categories).map(([cat, items]) => (
                <div key={cat}>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5 px-1">{cat}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {items.map((item) => {
                      const isDisabled = scopeLocked && isCageOnly && !CAGE_ONLY_SCOPE.includes(item.id);
                      return (
                        <label
                          key={item.id}
                          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-all ${
                            isDisabled
                              ? "border-border bg-muted/30 text-muted-foreground/40 cursor-not-allowed opacity-50"
                              : selectedItems.includes(item.id)
                                ? "border-primary/40 bg-primary/5 text-foreground cursor-pointer"
                                : "border-border hover:bg-accent/50 text-muted-foreground cursor-pointer"
                          }`}
                        >
                          <Checkbox
                            checked={selectedItems.includes(item.id)}
                            onCheckedChange={() => toggleItem(item.id)}
                            disabled={isDisabled}
                            className="h-3.5 w-3.5"
                          />
                          <span>{item.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {scopeLocked && isCageOnly && (
              <p className="text-[10px] text-muted-foreground italic mt-2 px-1">
                Scope locked for cage-only project. Click "Reset to all" to override.
              </p>
            )}
          </div>
        )}

        {/* Bar list only note */}
        {isBarListOnly && (
          <div className="flex items-start gap-2 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 border border-blue-400/30 p-3">
            <Info className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              Bar list project — elements will be parsed directly from the schedule table. No element type selection needed.
            </p>
          </div>
        )}

        {/* Rebar Coating */}
        <div>
          <Label className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2 block">Rebar Coating</Label>
          {/* Coating auto-detection banner */}
          {normalized?.detectedCoating && normalized.detectedCoating !== "none" && (
            <div className="flex items-center gap-3 rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 mb-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                  Coating detected from drawings: <strong>
                    {normalized.detectedCoating === "EPOXY" ? "Epoxy-Coated" :
                     normalized.detectedCoating === "GALVANISED" ? "Galvanized" :
                     normalized.detectedCoating === "STAINLESS" ? "Stainless Steel" :
                     normalized.detectedCoating === "MMFX" ? "MMFX / High-Strength" :
                     normalized.detectedCoating}
                  </strong> — pricing multiplier (
                    {normalized.detectedCoating === "EPOXY" ? "1.20" :
                     normalized.detectedCoating === "GALVANISED" ? "1.35" :
                     normalized.detectedCoating === "STAINLESS" ? "6.0" :
                     normalized.detectedCoating === "MMFX" ? "1.50" : "1.0"}x) will apply
                </p>
              </div>
              <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-600 dark:text-amber-400">
                {normalized.detectedCoating === "EPOXY" ? "ECR" :
                 normalized.detectedCoating === "GALVANISED" ? "GALV" :
                 normalized.detectedCoating === "STAINLESS" ? "SS" :
                 normalized.detectedCoating}
              </Badge>
            </div>
          )}
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
          disabled={disabled || (selectedItems.length === 0 && !isBarListOnly) || isDetecting}
          className="w-full gap-2 h-10 rounded-xl font-semibold"
        >
          {isBarListOnly
            ? "Proceed with Bar List parsing"
            : `Proceed with ${selectedItems.length} element type${selectedItems.length !== 1 ? "s" : ""}`
          }
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default ScopeDefinitionPanel;
