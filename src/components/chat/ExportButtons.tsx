import React, { forwardRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, FileText, Ruler, Share2, Code, Copy, Check, ChevronDown, AlertTriangle } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import ShopDrawingModal from "./ShopDrawingModal";
import ShareReviewDialog from "./ShareReviewDialog";
import { getMassKgPerM, kgToLbs } from "@/lib/rebar-weights";
import { exportExcelFile } from "@/lib/excel-export";
import { exportPdfFile } from "@/lib/pdf-export";
import { toast } from "sonner";

interface ExportButtonsProps {
  quoteResult: any;
  elements: any[];
  scopeData?: any;
  projectId?: string;
}

const ExportButtons = forwardRef<HTMLDivElement, ExportButtonsProps>(({ quoteResult, elements, scopeData, projectId }, ref) => {
  const [shopDrawingOpen, setShopDrawingOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const quote = quoteResult?.quote || {};
  const barList: any[] = quote.bar_list || [];
  const sizeBreakdown: Record<string, number> = quote.size_breakdown || {};
  const sizeBreakdownKg: Record<string, number> = quote.size_breakdown_kg || {};
  const totalLbs = quote.total_weight_lbs;
  const totalKg = quote.total_weight_kg || (totalLbs ? totalLbs * 0.453592 : 0);
  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const isBlocked = quote.job_status === "VALIDATION_FAILED" || quote.job_status === "BLOCKED";
  const isFlagged = quote.reconciliation?.risk_level === "FLAG" || quote.job_status === "FLAGGED";

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(quoteResult, null, 2));
    setCopied(true);
    toast.success("JSON copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExcelExport = async () => {
    if (isBlocked) {
      toast.warning("Estimate is BLOCKED — exporting with warning banner");
    }
    await exportExcelFile({ quoteResult, elements, scopeData });
  };

  const handlePdfExport = async () => {
    if (isBlocked) {
      toast.warning("Estimate is BLOCKED — PDF includes warning banner");
    }
    await exportPdfFile({ quoteResult, elements, scopeData, projectId });
  };

  return (
    <div ref={ref} className="flex flex-col gap-2 mt-4 pt-3 border-t border-border">
      {/* JSON Dropdown Accordion — collapsed by default */}
      <Collapsible open={jsonOpen} onOpenChange={setJsonOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="outline"
            className="w-full gap-2 h-10 rounded-xl font-semibold justify-between"
          >
            <span className="flex items-center gap-2">
              <Code className="h-4 w-4" />
              Structured JSON Output
            </span>
            <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${jsonOpen ? "rotate-180" : ""}`} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="relative mt-2 rounded-lg border border-border bg-muted/50">
            <div className="absolute top-2 right-2 z-10">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleCopyJson}
              >
                {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <div className="max-h-[300px] overflow-auto p-3">
              <pre className="text-[10px] font-mono whitespace-pre-wrap break-all text-foreground/80 select-all">
                {JSON.stringify(quoteResult, null, 2)}
              </pre>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Warning for blocked/flagged estimates */}
      {isBlocked && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs font-medium">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Estimate is BLOCKED — exports will include warning banner
        </div>
      )}
      {!isBlocked && isFlagged && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-700 dark:text-yellow-400 text-xs font-medium">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Estimate flagged for review — verify before final use
        </div>
      )}

      {/* Export buttons: PDF then Excel */}
      <div className="flex gap-2">
        <Button variant="outline" onClick={handlePdfExport} className="flex-1 gap-2 h-10 rounded-xl font-semibold">
          <FileText className="h-4 w-4" />
          Export PDF
        </Button>
        <Button onClick={handleExcelExport} className="flex-1 gap-2 h-10 rounded-xl font-semibold bg-primary hover:bg-primary/90">
          <FileSpreadsheet className="h-4 w-4" />
          Export Excel
        </Button>
      </div>
      <Button
        variant="outline"
        onClick={() => setShopDrawingOpen(true)}
        className="w-full gap-2 h-10 rounded-xl font-semibold border-primary/30 text-primary hover:bg-primary/10"
      >
        <Ruler className="h-4 w-4" />
        Create Shop Drawing
      </Button>
      <Button
        variant="outline"
        onClick={() => setShareOpen(true)}
        className="w-full gap-2 h-10 rounded-xl font-semibold border-accent/30 text-accent-foreground hover:bg-accent/10"
      >
        <Share2 className="h-4 w-4" />
        Share for Review
      </Button>
      <ShopDrawingModal open={shopDrawingOpen} onOpenChange={setShopDrawingOpen} quoteResult={quoteResult} elements={elements} scopeData={scopeData} projectId={projectId} />
      <ShareReviewDialog open={shareOpen} onOpenChange={setShareOpen} projectId={projectId} />
    </div>
  );
});

ExportButtons.displayName = "ExportButtons";

export default ExportButtons;
