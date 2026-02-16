import React from "react";
import { CheckCircle2, AlertTriangle, XCircle, Shield, Zap, FileCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import QuestionCard from "./QuestionCard";

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

const ValidationResults: React.FC<ValidationResultsProps> = ({
  elements,
  summary,
  questions,
  quoteResult,
  onAnswerQuestion,
  onRequestQuote,
}) => {
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

      {/* Element List */}
      <div className="space-y-2">
        {elements.map((el) => (
          <div
            key={el.element_id}
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
          {quoteResult.excluded && quoteResult.excluded.length > 0 && (
            <div className="mt-3 text-xs text-muted-foreground">
              <p className="font-medium">Excluded ({quoteResult.excluded_count}):</p>
              {quoteResult.excluded.map((ex: any, i: number) => (
                <p key={i}>• {ex.element_id}: {ex.reason}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ValidationResults;
