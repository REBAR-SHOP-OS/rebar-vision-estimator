import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle, FileText, AlertOctagon, Lightbulb } from "lucide-react";
import type { EstimateLineItem } from "./EstimateGrid";

interface EvidenceDrawerProps {
  item: EstimateLineItem | null;
  onApprove: (id: string) => void;
  onMarkReview: (id: string) => void;
  onBlock: (id: string) => void;
  onClarify: (id: string) => void;
}

export default function EvidenceDrawer({ item, onApprove, onMarkReview, onBlock, onClarify }: EvidenceDrawerProps) {
  if (!item) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground px-6 text-center">
        <FileText className="h-8 w-8 mb-3 opacity-40" />
        <p className="text-sm font-medium">Select a row</p>
        <p className="text-xs mt-1">Click an estimate row to view source evidence and validation details.</p>
      </div>
    );
  }

  const STATUS_MAP: Record<string, { label: string; icon: React.ElementType; color: string }> = {
    approved: { label: "Approved", icon: CheckCircle2, color: "text-[hsl(var(--status-approved))]" },
    needs_review: { label: "Needs Review", icon: AlertTriangle, color: "text-[hsl(var(--status-review))]" },
    blocked: { label: "Blocked", icon: XCircle, color: "text-[hsl(var(--status-blocked))]" },
  };

  const s = STATUS_MAP[item.status] || STATUS_MAP.needs_review;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono text-sm font-bold text-foreground">{item.elementId}</span>
          <Badge variant="outline" className="text-[10px]">{item.elementType}</Badge>
        </div>
        <div className="flex items-center gap-1.5">
          <s.icon className={`h-3.5 w-3.5 ${s.color}`} />
          <span className={`text-xs font-medium ${s.color}`}>{s.label}</span>
          <span className="text-xs text-muted-foreground ml-auto">Grade: {item.evidenceGrade}</span>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="source" className="flex-1 flex flex-col min-h-0">
        <TabsList className="mx-4 mt-2 h-8">
          <TabsTrigger value="source" className="text-[11px] h-7">Source</TabsTrigger>
          <TabsTrigger value="validation" className="text-[11px] h-7">Validation</TabsTrigger>
          <TabsTrigger value="bars" className="text-[11px] h-7">Bars</TabsTrigger>
          <TabsTrigger value="questions" className="text-[11px] h-7">Questions</TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-auto px-4 py-3">
          <TabsContent value="source" className="mt-0 space-y-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Source Sheets</p>
              {item.sourceSheets.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {item.sourceSheets.map((s) => (
                    <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">No source sheets linked</p>
              )}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Weight</p>
              <p className="text-sm font-mono">{item.weightKg.toLocaleString()} kg</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Cost Estimate</p>
              <p className="text-sm font-mono">${item.costEstimate.toLocaleString()}</p>
            </div>
          </TabsContent>

          <TabsContent value="validation" className="mt-0 space-y-3">
            {item.issuesCount > 0 ? (
              <div className="space-y-2">
                <div className="flex items-start gap-2 p-2.5 rounded-md bg-[hsl(var(--status-blocked)/.06)] border border-[hsl(var(--status-blocked)/.15)]">
                  <AlertOctagon className="h-4 w-4 text-[hsl(var(--status-blocked))] mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-[hsl(var(--status-blocked))]">{item.issuesCount} validation issue(s)</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Review issues before approving this element.</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 p-2.5 rounded-md bg-[hsl(var(--status-approved)/.06)]">
                <CheckCircle2 className="h-4 w-4 text-[hsl(var(--status-approved))]" />
                <p className="text-xs text-[hsl(var(--status-approved))]">No validation issues</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="bars" className="mt-0">
            <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50">
              <Lightbulb className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Bar detail data will appear here after takeoff.</p>
            </div>
          </TabsContent>

          <TabsContent value="questions" className="mt-0">
            {item.questionsCount > 0 ? (
              <div className="flex items-start gap-2 p-2.5 rounded-md bg-[hsl(var(--status-review)/.06)] border border-[hsl(var(--status-review)/.15)]">
                <HelpCircle className="h-4 w-4 text-[hsl(var(--status-review))] mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-medium text-[hsl(var(--status-review))]">{item.questionsCount} question(s)</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Clarification needed before approval.</p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic p-3">No questions raised.</p>
            )}
          </TabsContent>
        </div>
      </Tabs>

      {/* Actions */}
      <div className="border-t border-border p-3 space-y-1.5">
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" variant="outline" className="text-[11px] h-8 border-[hsl(var(--status-approved)/.3)] text-[hsl(var(--status-approved))] hover:bg-[hsl(var(--status-approved)/.08)]" onClick={() => onApprove(item.id)}>
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
          </Button>
          <Button size="sm" variant="outline" className="text-[11px] h-8 border-[hsl(var(--status-review)/.3)] text-[hsl(var(--status-review))] hover:bg-[hsl(var(--status-review)/.08)]" onClick={() => onMarkReview(item.id)}>
            <AlertTriangle className="h-3.5 w-3.5 mr-1" /> Review
          </Button>
          <Button size="sm" variant="outline" className="text-[11px] h-8 border-[hsl(var(--status-blocked)/.3)] text-[hsl(var(--status-blocked))] hover:bg-[hsl(var(--status-blocked)/.08)]" onClick={() => onBlock(item.id)}>
            <XCircle className="h-3.5 w-3.5 mr-1" /> Block
          </Button>
          <Button size="sm" variant="outline" className="text-[11px] h-8" onClick={() => onClarify(item.id)}>
            <HelpCircle className="h-3.5 w-3.5 mr-1" /> Clarify
          </Button>
        </div>
      </div>
    </div>
  );
}
