import React, { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Settings2, ArrowRight } from "lucide-react";

const SCOPE_ITEMS = [
  { id: "FOOTING", label: "Footings" },
  { id: "GRADE_BEAM", label: "Grade Beams" },
  { id: "RAFT_SLAB", label: "Raft Slabs" },
  { id: "WALL", label: "Walls" },
  { id: "RETAINING_WALL", label: "Retaining Walls" },
  { id: "ICF_WALL", label: "ICF Walls" },
  { id: "CMU_WALL", label: "CMU Walls" },
  { id: "PIER", label: "Piers / Pedestals" },
  { id: "COLUMN", label: "Columns" },
  { id: "SLAB", label: "Slabs" },
  { id: "STAIR", label: "Stairs" },
  { id: "WIRE_MESH", label: "Wire Mesh" },
] as const;

export interface ScopeData {
  scopeItems: string[];
  clientName: string;
  projectType: string;
  deviations: string;
}

interface ScopeDefinitionPanelProps {
  onProceed: (scope: ScopeData) => void;
  disabled?: boolean;
}

const ScopeDefinitionPanel: React.FC<ScopeDefinitionPanelProps> = ({ onProceed, disabled }) => {
  const [selectedItems, setSelectedItems] = useState<string[]>(SCOPE_ITEMS.map((s) => s.id));
  const [clientName, setClientName] = useState("");
  const [projectType, setProjectType] = useState("");
  const [deviations, setDeviations] = useState("");

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
    });
  };

  return (
    <Card className="border-primary/20 bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Settings2 className="h-5 w-5 text-primary" />
          Define Takeoff Scope
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Element Type Checkboxes */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-sm font-medium">Element Types</Label>
            <button
              type="button"
              onClick={toggleAll}
              className="text-xs text-primary hover:underline"
            >
              {selectedItems.length === SCOPE_ITEMS.length ? "Deselect All" : "Select All"}
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {SCOPE_ITEMS.map((item) => (
              <label
                key={item.id}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm cursor-pointer hover:bg-accent/50 transition-colors"
              >
                <Checkbox
                  checked={selectedItems.includes(item.id)}
                  onCheckedChange={() => toggleItem(item.id)}
                />
                <span className="text-foreground">{item.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Metadata */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="clientName" className="text-xs text-muted-foreground">
              Client Name (optional)
            </Label>
            <Input
              id="clientName"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. ABC Construction"
              className="mt-1 h-9 text-sm"
            />
          </div>
          <div>
            <Label htmlFor="projectType" className="text-xs text-muted-foreground">
              Project Type (optional)
            </Label>
            <Select value={projectType} onValueChange={setProjectType}>
              <SelectTrigger className="mt-1 h-9 text-sm">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="commercial">Commercial</SelectItem>
                <SelectItem value="residential">Residential</SelectItem>
                <SelectItem value="industrial">Industrial</SelectItem>
                <SelectItem value="infrastructure">Infrastructure</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Deviations */}
        <div>
          <Label htmlFor="deviations" className="text-xs text-muted-foreground">
            Project-Specific Deviations (optional)
          </Label>
          <Textarea
            id="deviations"
            value={deviations}
            onChange={(e) => setDeviations(e.target.value)}
            placeholder="Any special notes, exclusions, or deviations from standard..."
            className="mt-1 text-sm min-h-[60px]"
            rows={2}
          />
        </div>

        {/* Proceed */}
        <Button
          onClick={handleProceed}
          disabled={disabled || selectedItems.length === 0}
          className="w-full gap-2"
        >
          Proceed with {selectedItems.length} element type{selectedItems.length !== 1 ? "s" : ""}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
};

export default ScopeDefinitionPanel;
