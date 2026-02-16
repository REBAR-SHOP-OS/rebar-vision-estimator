import React, { useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Shield, Zap, FileCheck, ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
  extraction?: {
    truth?: any;
    confidence?: number;
  };
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
}

const StatusIcon: React.FC<{ status: string }> = ({ status }) => {
  switch (status) {
    case "READY":
      return <CheckCircle2 className="h-4 w-4 text-primary" />;
    case "FLAGGED":
      return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    case "BLOCKED":
      return <XCircle className="h-4 w-4 text-destructive" />;
    default:
      return null;
  }
};

const GateBadge: React.FC<{ name: string; passed: boolean }> = ({ name, passed }) => (
  <Badge variant={passed ? "secondary" : "destructive"} className="text-[10px] px-1.5 py-0">
    {passed ? "✓" : "✗"} {name}
  </Badge>
);

const ElementCard: React.FC<{ el: ValidationElement; weightInfo?: any }> = ({ el, weightInfo }) => (
  <div
    className={`p-3 rounded-lg border ${
      el.status === "READY"
        ? "border-primary/30 bg-primary/5"
        : el.status === "FLAGGED"
        ? "border-amber-500/30 bg-amber-500/5"
        : "border-destructive/30 bg-destructive/5"
    }`}
  >
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-2">
        <StatusIcon status={el.status} />
        <span className="text-sm font-semibold text-foreground">{el.element_id}</span>
        <Badge variant="outline" className="text-[10px]">{el.element_type}</Badge>
        {weightInfo && (
          <span className="text-[10px] text-muted-foreground font-medium">
            {weightInfo.weight_lbs.toLocaleString()} lbs
          </span>
        )}
      </div>
      <Badge
        variant={el.status === "READY" ? "secondary" : el.status === "FLAGGED" ? "outline" : "destructive"}
        className="text-[10px]"
      >
        {el.status}
      </Badge>
    </div>

    {/* Gate Results */}
    <div className="flex gap-1.5 flex-wrap mb-2">
      <GateBadge name="Identity" passed={el.validation.identity.passed} />
      <GateBadge name="Complete" passed={el.validation.completeness.passed} />
      <GateBadge name="Consistent" passed={el.validation.consistency.passed} />
      <GateBadge name="Scope" passed={el.validation.scope.passed} />
    </div>

    {/* Confidence Bar */}
    {el.extraction?.confidence !== undefined && (
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] text-muted-foreground w-16">Confidence</span>
        <Progress value={el.extraction.confidence * 100} className="h-1.5 flex-1" />
        <span className="text-[10px] font-medium text-foreground">
          {(el.extraction.confidence * 100).toFixed(0)}%
        </span>
      </div>
    )}

    {/* Truth data */}
    {el.extraction?.truth && (
      <div className="text-xs text-muted-foreground mt-1">
        {el.extraction.truth.vertical_bars && (
          <span className="mr-3">
            Vert: {el.extraction.truth.vertical_bars.qty}×{el.extraction.truth.vertical_bars.size}
          </span>
        )}
        {el.extraction.truth.ties && (
          <span>
            Ties: {el.extraction.truth.ties.size} @{el.extraction.truth.ties.spacing_mm}mm
          </span>
        )}
      </div>
    )}

    {/* Errors/Warnings */}
    {el.validation.errors.length > 0 && (
      <div className="mt-2 space-y-1">
        {el.validation.errors.map((err, i) => (
          <p key={i} className="text-xs text-destructive">⛔ {err}</p>
        ))}
      </div>
    )}
    {el.validation.warnings.length > 0 && (
      <div className="mt-1 space-y-1">
        {el.validation.warnings.map((warn, i) => (
          <p key={i} className="text-xs text-amber-600 dark:text-amber-400">⚠️ {warn}</p>
        ))}
      </div>
    )}
  </div>
);

const ValidationResults: React.FC<ValidationResultsProps> = ({
  elements,
  summary,
  questions,
  quoteResult,
  onAnswerQuestion,
  onRequestQuote,
}) => {
  // Group elements by type
  const grouped = elements.reduce<Record<string, ValidationElement[]>>((acc, el) => {
    const type = el.element_type || "OTHER";
    if (!acc[type]) acc[type] = [];
    acc[type].push(el);
    return acc;
  }, {});

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(
    () => Object.keys(grouped).reduce((acc, k) => ({ ...acc, [k]: true }), {} as Record<string, boolean>)
  );

  // Map element weights from quote
  const weightMap: Record<string, any> = {};
  if (quoteResult?.quote?.elements) {
    for (const el of quoteResult.quote.elements) {
      weightMap[el.element_id] = el;
    }
  }

  return (
    <div className="space-y-4 my-4">
      {/* Summary Bar */}
      <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card">
        <Shield className="h-5 w-5 text-primary flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">
            Validation: {summary.total_elements} elements
          </p>
          <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
            <span className="text-primary font-medium">{summary.ready_count} Ready</span>
            {summary.flagged_count > 0 && (
              <span className="text-amber-500 font-medium">{summary.flagged_count} Flagged</span>
            )}
            {summary.blocked_count > 0 && (
              <span className="text-destructive font-medium">{summary.blocked_count} Blocked</span>
            )}
          </div>
        </div>
        {summary.job_status === "HUMAN_REVIEW_REQUIRED" && (
          <Badge variant="destructive" className="text-xs">Human Review Required</Badge>
        )}
      </div>

      {/* Element List — Grouped by Type */}
      <div className="space-y-2">
        {Object.entries(grouped).map(([type, els]) => (
          <Collapsible
            key={type}
            open={openGroups[type]}
            onOpenChange={(open) => setOpenGroups((prev) => ({ ...prev, [type]: open }))}
          >
            <CollapsibleTrigger className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-md hover:bg-accent/50 transition-colors">
              {openGroups[type] ? (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span className="text-xs font-semibold text-foreground">{type}</span>
              <Badge variant="outline" className="text-[10px] ml-auto">{els.length}</Badge>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 mt-1 pl-2">
              {els.map((el) => (
                <ElementCard key={el.element_id} el={el} weightInfo={weightMap[el.element_id]} />
              ))}
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>

      {/* Questions for FLAGGED elements */}
      {questions.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Questions ({questions.length})
          </p>
          {questions.map((q, i) => (
            <QuestionCard key={i} question={q} onAnswer={onAnswerQuestion} />
          ))}
        </div>
      )}

      {/* Quote Actions */}
      {summary.ready_count > 0 && !quoteResult && (
        <div className="flex gap-2 p-3 rounded-lg border border-border bg-card">
          <button
            onClick={() => onRequestQuote?.("ai_express")}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Zap className="h-4 w-4" />
            AI Express Quote ({summary.ready_count} elements)
          </button>
          {summary.flagged_count === 0 && summary.blocked_count === 0 && (
            <button
              onClick={() => onRequestQuote?.("verified")}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-primary text-primary text-sm font-medium hover:bg-primary/10 transition-colors"
            >
              <FileCheck className="h-4 w-4" />
              Verified Quote
            </button>
          )}
        </div>
      )}

      {/* Quote Result */}
      {quoteResult && quoteResult.quote && (
        <div className="p-4 rounded-lg border-2 border-primary bg-primary/5">
          <div className="flex items-center gap-2 mb-3">
            {quoteResult.mode === "ai_express" ? (
              <Zap className="h-5 w-5 text-primary" />
            ) : (
              <FileCheck className="h-5 w-5 text-primary" />
            )}
            <span className="text-sm font-semibold text-foreground">
              {quoteResult.mode === "ai_express" ? "AI Express" : "Verified"} Quote
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-primary">
                {quoteResult.quote.total_weight_lbs.toLocaleString()} lbs
              </p>
              <p className="text-xs text-muted-foreground">Total Weight</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-primary">
                {quoteResult.quote.total_weight_tons} tons
              </p>
              <p className="text-xs text-muted-foreground">Total Tons</p>
            </div>
          </div>

          {/* Size Breakdown Table */}
          <SizeBreakdownTable sizeBreakdown={quoteResult.quote.size_breakdown} />

          {quoteResult.excluded && quoteResult.excluded.length > 0 && (
            <div className="mt-3 text-xs text-muted-foreground">
              <p className="font-medium">Excluded ({quoteResult.excluded_count}):</p>
              {quoteResult.excluded.map((ex: any, i: number) => (
                <p key={i}>• {ex.element_id}: {ex.reason}</p>
              ))}
            </div>
          )}

          {/* Export Buttons */}
          <ExportButtons quoteResult={quoteResult} elements={elements} />
        </div>
      )}
    </div>
  );
};

export default ValidationResults;
