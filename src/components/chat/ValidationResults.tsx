import React, { useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Shield, Zap, FileCheck, ChevronDown, ChevronRight, MapPin, Map, Target, ClipboardCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import QuestionCard from "./QuestionCard";
import ExportButtons from "./ExportButtons";
import SizeBreakdownTable from "./SizeBreakdownTable";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface ValidationElement {
  element_id: string;
  element_type: string;
  status: "READY" | "FLAGGED" | "BLOCKED";
  validation: {
    identity: { passed: boolean; details: any };
    completeness: { passed: boolean; details: any };
    consistency: { passed: boolean; details: any };
    scope: { passed: boolean; details: any };
    errors: string[];
    warnings: string[];
  };
  questions: any[];
  extraction?: { truth?: any; confidence?: number };
  regions?: { tag_region?: { bbox?: number[] } };
}

interface QuoteResult {
  mode: string;
  quote?: {
    total_weight_lbs: number;
    total_weight_tons: number;
    elements: any[];
    size_breakdown: Record<string, number>;
  };
  included_count?: number;
  excluded_count?: number;
  excluded?: any[];
  status?: string;
}

interface ValidationResultsProps {
  elements: ValidationElement[];
  summary: {
    total_elements: number;
    ready_count: number;
    flagged_count: number;
    blocked_count: number;
    job_status: string;
    total_questions: number;
  };
  questions: any[];
  quoteResult?: QuoteResult | null;
  onAnswerQuestion?: (elementId: string, field: string, value: string) => void;
  onRequestQuote?: (mode: "ai_express" | "verified") => void;
  scopeData?: any;
  onShowOnDrawing?: (elementId: string) => void;
  onToggleViewer?: () => void;
  showViewer?: boolean;
  selectedElementId?: string | null;
  hasDrawingData?: boolean;
  onStartReview?: () => void;
}

const StatusIcon: React.FC<{ status: string }> = ({ status }) => {
  switch (status) {
    case "READY": return <CheckCircle2 className="h-4 w-4 text-primary" />;
    case "FLAGGED": return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    case "BLOCKED": return <XCircle className="h-4 w-4 text-destructive" />;
    default: return null;
  }
};

const GateBadge: React.FC<{ name: string; passed: boolean }> = ({ name, passed }) => (
  <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md font-medium ${
    passed ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
  }`}>
    {passed ? "✓" : "✗"} {name}
  </span>
);

interface ElementCardProps {
  el: ValidationElement;
  weightInfo?: any;
  onShowOnDrawing?: (id: string) => void;
  isSelected?: boolean;
  hasBbox?: boolean;
}

const ElementCard: React.FC<ElementCardProps> = ({ el, weightInfo, onShowOnDrawing, isSelected, hasBbox }) => (
  <div
    id={`element-card-${el.element_id}`}
    className={`p-4 rounded-xl border-2 transition-all ${
      isSelected
        ? "border-primary ring-2 ring-primary/30 bg-primary/10"
        : el.status === "READY" ? "border-primary/20 bg-primary/5"
        : el.status === "FLAGGED" ? "border-amber-500/20 bg-amber-500/5"
        : "border-destructive/20 bg-destructive/5"
    }`}
  >
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-2">
        <StatusIcon status={el.status} />
        <span className="text-sm font-bold text-foreground">{el.element_id}</span>
        <Badge variant="outline" className="text-[10px] rounded-md">{el.element_type}</Badge>
        {weightInfo && (
          <span className="text-[10px] text-primary font-semibold">
            {weightInfo.weight_lbs.toLocaleString()} lbs
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        {onShowOnDrawing && (
          <button
            onClick={() => onShowOnDrawing(el.element_id)}
            className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-accent hover:bg-accent/80 text-foreground font-medium transition-colors"
            title={hasBbox ? "Show on Drawing" : "View Document"}
          >
            <MapPin className="h-3 w-3" />
          </button>
        )}
        <Badge variant={el.status === "READY" ? "secondary" : el.status === "FLAGGED" ? "outline" : "destructive"} className="text-[10px] rounded-md">
          {el.status}
        </Badge>
      </div>
    </div>
    <div className="flex gap-1.5 flex-wrap mb-2">
      <GateBadge name="Identity" passed={el.validation.identity.passed} />
      <GateBadge name="Complete" passed={el.validation.completeness.passed} />
      <GateBadge name="Consistent" passed={el.validation.consistency.passed} />
      <GateBadge name="Scope" passed={el.validation.scope.passed} />
    </div>
    {el.extraction?.confidence !== undefined && (
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] text-muted-foreground w-16">Confidence</span>
        <Progress value={el.extraction.confidence * 100} className="h-1.5 flex-1" />
        <span className="text-[10px] font-semibold text-foreground">{(el.extraction.confidence * 100).toFixed(0)}%</span>
      </div>
    )}
    {el.extraction?.truth && (
      <div className="text-xs text-muted-foreground mt-1">
        {el.extraction.truth.vertical_bars && <span className="mr-3">Vert: {el.extraction.truth.vertical_bars.qty}×{el.extraction.truth.vertical_bars.size}</span>}
        {el.extraction.truth.ties && <span>Ties: {el.extraction.truth.ties.size} @{el.extraction.truth.ties.spacing_mm}mm</span>}
      </div>
    )}
    {el.validation.errors.length > 0 && (
      <div className="mt-2 space-y-1">
        {el.validation.errors.map((err, i) => <p key={i} className="text-xs text-destructive">⛔ {err}</p>)}
      </div>
    )}
    {el.validation.warnings.length > 0 && (
      <div className="mt-1 space-y-1">
        {el.validation.warnings.map((warn, i) => <p key={i} className="text-xs text-amber-600 dark:text-amber-400">⚠️ {warn}</p>)}
      </div>
    )}
  </div>
);

const ValidationResults: React.FC<ValidationResultsProps> = ({
  elements, summary, questions, quoteResult, onAnswerQuestion, onRequestQuote, scopeData,
  onShowOnDrawing, onToggleViewer, showViewer, selectedElementId, hasDrawingData, onStartReview,
}) => {
  const grouped = elements.reduce<Record<string, ValidationElement[]>>((acc, el) => {
    const type = el.element_type || "OTHER";
    if (!acc[type]) acc[type] = [];
    acc[type].push(el);
    return acc;
  }, {});

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(
    () => Object.keys(grouped).reduce((acc, k) => ({ ...acc, [k]: true }), {} as Record<string, boolean>)
  );

  const weightMap: Record<string, any> = {};
  if (quoteResult?.quote?.elements) {
    for (const el of quoteResult.quote.elements) weightMap[el.element_id] = el;
  }

  const hasBboxData = (el: ValidationElement) => {
    const bbox = el.regions?.tag_region?.bbox;
    return bbox && bbox.length === 4 && (bbox[2] > bbox[0] || bbox[3] > bbox[1]);
  };

  return (
    <div className="space-y-4 my-4">
      {/* View Drawing Toggle */}
      {hasDrawingData && onToggleViewer && (
        <div className="flex gap-2">
          <Button
            onClick={onToggleViewer}
            variant={showViewer ? "default" : "outline"}
            className="flex-1 rounded-xl gap-2 font-semibold"
            size="sm"
          >
            <Map className="h-4 w-4" />
            {showViewer ? "Hide Document Viewer" : "View Document"}
          </Button>
          {onStartReview && (
            <Button
              onClick={onStartReview}
              variant="outline"
              className="flex-1 rounded-xl gap-2 font-semibold border-primary/30 text-primary hover:bg-primary/10"
              size="sm"
            >
              <ClipboardCheck className="h-4 w-4" />
              Review Elements
            </Button>
          )}
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <Shield className="h-5 w-5 text-primary mx-auto mb-1" />
          <p className="text-2xl font-bold text-foreground">{summary.total_elements}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Elements</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <CheckCircle2 className="h-5 w-5 text-primary mx-auto mb-1" />
          <p className="text-2xl font-bold text-primary">{summary.ready_count}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Ready</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          {summary.flagged_count + summary.blocked_count > 0 ? (
            <AlertTriangle className="h-5 w-5 text-amber-500 mx-auto mb-1" />
          ) : (
            <Target className="h-5 w-5 text-primary mx-auto mb-1" />
          )}
          <p className="text-2xl font-bold text-foreground">{summary.flagged_count + summary.blocked_count}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Needs Review</p>
        </div>
      </div>

      {summary.job_status === "HUMAN_REVIEW_REQUIRED" && (
        <div className="flex items-center gap-2 p-3 rounded-xl border-2 border-destructive/30 bg-destructive/5">
          <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
          <span className="text-xs font-semibold text-destructive">Human Review Required</span>
        </div>
      )}

      {/* Element Groups */}
      <div className="space-y-2">
        {Object.entries(grouped).map(([type, els]) => (
          <Collapsible key={type} open={openGroups[type]} onOpenChange={(open) => setOpenGroups((prev) => ({ ...prev, [type]: open }))}>
            <CollapsibleTrigger className="flex items-center gap-2 w-full text-left px-3 py-2.5 rounded-xl hover:bg-accent/50 transition-colors border border-border bg-card">
              {openGroups[type] ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              <span className="text-xs font-bold text-foreground">{type}</span>
              <Badge variant="secondary" className="text-[10px] ml-auto rounded-md">{els.length}</Badge>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 mt-2 pl-2">
              {els.map((el) => (
                <ElementCard
                  key={el.element_id}
                  el={el}
                  weightInfo={weightMap[el.element_id]}
                  onShowOnDrawing={onShowOnDrawing}
                  isSelected={el.element_id === selectedElementId}
                  hasBbox={hasBboxData(el)}
                />
              ))}
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>

      {/* Questions */}
      {questions.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-foreground flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Questions ({questions.length})
          </p>
          {questions.map((q, i) => <QuestionCard key={i} question={q} onAnswer={onAnswerQuestion} />)}
        </div>
      )}

      {/* Quote Actions */}
      {summary.ready_count > 0 && !quoteResult && (
        <div className="flex gap-3 p-4 rounded-xl border-2 border-border bg-card">
          <button onClick={() => onRequestQuote?.("ai_express")} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors">
            <Zap className="h-4 w-4" /> AI Express ({summary.ready_count})
          </button>
          {summary.flagged_count === 0 && summary.blocked_count === 0 && (
            <button onClick={() => onRequestQuote?.("verified")} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-primary text-primary text-sm font-bold hover:bg-primary/10 transition-colors">
              <FileCheck className="h-4 w-4" /> Verified Quote
            </button>
          )}
        </div>
      )}

      {/* Quote Result */}
      {quoteResult && quoteResult.quote && (
        <div className="p-5 rounded-xl border-2 border-primary bg-primary/5">
          <div className="flex items-center gap-2 mb-4">
            {quoteResult.mode === "ai_express" ? <Zap className="h-5 w-5 text-primary" /> : <FileCheck className="h-5 w-5 text-primary" />}
            <span className="text-sm font-bold text-foreground">{quoteResult.mode === "ai_express" ? "AI Express" : "Verified"} Quote</span>
          </div>
          <div className="grid grid-cols-2 gap-4 text-center">
            <div className="rounded-xl bg-card border border-border p-4">
              <p className="text-2xl font-bold text-primary">{quoteResult.quote.total_weight_lbs.toLocaleString()} lbs</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">Total Weight</p>
            </div>
            <div className="rounded-xl bg-card border border-border p-4">
              <p className="text-2xl font-bold text-primary">{quoteResult.quote.total_weight_tons} tons</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">Total Tons</p>
            </div>
          </div>
          <SizeBreakdownTable sizeBreakdown={quoteResult.quote.size_breakdown} />
          {quoteResult.excluded && quoteResult.excluded.length > 0 && (
            <div className="mt-3 text-xs text-muted-foreground">
              <p className="font-semibold">Excluded ({quoteResult.excluded_count}):</p>
              {quoteResult.excluded.map((ex: any, i: number) => <p key={i}>• {ex.element_id}: {ex.reason}</p>)}
            </div>
          )}
          <ExportButtons quoteResult={quoteResult} elements={elements} scopeData={scopeData} />
        </div>
      )}
    </div>
  );
};

export default ValidationResults;
