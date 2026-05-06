import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  Edit3,
  Check,
  X,
} from "lucide-react";

export interface ReviewElement {
  element_id: string;
  element_type: string;
  status: string;
  extraction?: {
    confidence?: number;
    truth?: Record<string, unknown>;
  };
  regions?: {
    tag_region?: {
      page_number?: number;
      bbox?: number[];
    };
  };
}

export interface ReviewAnswer {
  element_id: string;
  confirmed: boolean;
  correctedValue?: string;
  field?: string;
}

interface ElementReviewPanelProps {
  elements: ReviewElement[];
  onComplete: (answers: ReviewAnswer[]) => void;
  onCancel: () => void;
  onSelectElement?: (elementId: string) => void;
  /** Exposes the current answers map so parent can derive review statuses */
  onAnswersChange?: (answers: Map<string, ReviewAnswer>) => void;
}

const ElementReviewPanel: React.FC<ElementReviewPanelProps> = ({
  elements,
  onComplete,
  onCancel,
  onSelectElement,
  onAnswersChange,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Map<string, ReviewAnswer>>(new Map());
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [reviewComplete, setReviewComplete] = useState(false);

  const total = elements.length;
  const reviewed = answers.size;
  const progressPercent = total > 0 ? (reviewed / total) * 100 : 0;
  const current = elements[currentIndex] ?? null;

  // Auto-select element in viewer whenever index changes
  React.useEffect(() => {
    if (current) {
      onSelectElement?.(current.element_id);
    }
  }, [currentIndex, current?.element_id]);

  const updateAnswers = (next: Map<string, ReviewAnswer>) => {
    setAnswers(next);
    onAnswersChange?.(next);
  };

  const goTo = (idx: number) => {
    const clamped = Math.max(0, Math.min(total - 1, idx));
    setCurrentIndex(clamped);
    setIsEditing(false);
    setEditValue("");
  };

  const handleConfirm = () => {
    if (!current) return;
    const next = new Map(answers);
    next.set(current.element_id, { element_id: current.element_id, confirmed: true });
    updateAnswers(next);
    // Auto-advance
    if (currentIndex < total - 1) goTo(currentIndex + 1);
  };

  const handleReject = () => {
    if (!current) return;
    const next = new Map(answers);
    next.set(current.element_id, { element_id: current.element_id, confirmed: false });
    updateAnswers(next);
    if (currentIndex < total - 1) goTo(currentIndex + 1);
  };

  const handleStartEdit = () => {
    if (!current) return;
    setIsEditing(true);
    const truth = current.extraction?.truth;
    setEditValue(truth ? JSON.stringify(truth, null, 2) : "");
  };

  const handleSaveEdit = () => {
    if (!current) return;
    const next = new Map(answers);
    next.set(current.element_id, {
      element_id: current.element_id,
      confirmed: true,
      correctedValue: editValue,
      field: "truth",
    });
    updateAnswers(next);
    setIsEditing(false);
    setEditValue("");
    if (currentIndex < total - 1) goTo(currentIndex + 1);
  };

  const handleFinishReview = () => {
    setReviewComplete(true);
    onComplete(Array.from(answers.values()));
  };

  // Summary screen
  if (reviewComplete) {
    const confirmed = Array.from(answers.values()).filter((a) => a.confirmed && !a.correctedValue).length;
    const corrected = Array.from(answers.values()).filter((a) => a.correctedValue).length;
    const rejected = Array.from(answers.values()).filter((a) => !a.confirmed && !a.correctedValue).length;

    return (
      <div className="space-y-4 p-4 rounded-xl border-2 border-primary bg-primary/5">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Review Complete</h3>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-lg bg-card border border-border p-3">
            <p className="text-xl font-bold text-primary">{confirmed}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Confirmed</p>
          </div>
          <div className="rounded-lg bg-card border border-border p-3">
            <p className="text-xl font-bold text-amber-500">{corrected}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Corrected</p>
          </div>
          <div className="rounded-lg bg-card border border-border p-3">
            <p className="text-xl font-bold text-destructive">{rejected}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Rejected</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Re-running validation with your corrections...
        </p>
      </div>
    );
  }

  if (!current) return null;

  const confidence = current.extraction?.confidence ?? 0;
  const lowConfidence = confidence < 0.82;
  const truth = current.extraction?.truth as any;
  const answer = answers.get(current.element_id);

  return (
    <div className="space-y-3 p-4 rounded-xl border-2 border-border bg-card">
      {/* Instruction */}
      <div className="flex items-center gap-2 p-2 rounded-lg bg-accent/50 border border-border">
        <span className="text-[11px] text-foreground">👉 Verify each element below. Click <strong>Confirm</strong>, <strong>Edit</strong>, or <strong>Reject</strong>, then move to <strong>Next</strong>.</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground">Review Elements</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">
            {currentIndex + 1} / {total}
          </span>
          <Button variant="ghost" size="sm" onClick={onCancel} className="text-xs h-7">
            <X className="h-3 w-3 mr-1" /> Cancel
          </Button>
        </div>
      </div>

      {/* Progress */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>Element {currentIndex + 1} of {total}</span>
          <span>{reviewed} reviewed</span>
        </div>
        <Progress value={progressPercent} className="h-2" />
      </div>

      {/* Current element card */}
      <div
        className={`p-4 rounded-xl border-2 transition-all ${
          answer
            ? answer.confirmed
              ? "border-primary/30 bg-primary/5"
              : "border-destructive/30 bg-destructive/5"
            : lowConfidence
            ? "border-amber-500/30 bg-amber-500/5"
            : "border-border bg-card"
        }`}
      >
        {/* Element header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-foreground">{current.element_id}</span>
            <Badge variant="outline" className="text-[10px] rounded-md">
              {current.element_type}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {answer && (
              <Badge
                variant={answer.confirmed ? "secondary" : "destructive"}
                className="text-[9px] rounded-md"
              >
                {answer.correctedValue ? "Corrected" : answer.confirmed ? "Confirmed" : "Rejected"}
              </Badge>
            )}
            <span className="text-xs font-semibold text-muted-foreground">
              {Math.round(confidence * 100)}%
            </span>
          </div>
        </div>

        {/* Confidence bar */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] text-muted-foreground w-16">Confidence</span>
          <Progress value={confidence * 100} className="h-1.5 flex-1" />
        </div>

        {/* Extracted data */}
        {truth && (
          <div className="rounded-lg bg-muted/50 border border-border p-3 mb-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1">
              Extracted Data
            </p>
            <div className="text-xs text-foreground font-mono space-y-0.5">
              {truth.vertical_bars && (
                <p>
                  vertical_bars: {truth.vertical_bars.qty}× {truth.vertical_bars.size}
                </p>
              )}
              {truth.ties && (
                <p>
                  ties: {truth.ties.size} @{truth.ties.spacing_mm}mm
                </p>
              )}
              {!truth.vertical_bars && !truth.ties && (
                <pre className="text-[10px] whitespace-pre-wrap break-all">
                  {JSON.stringify(truth, null, 2)}
                </pre>
              )}
            </div>
          </div>
        )}

        {/* Low confidence warning */}
        {lowConfidence && !answer && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 mb-3">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
            <span className="text-[10px] text-amber-600 dark:text-amber-400">
              Low confidence ({Math.round(confidence * 100)}%) — please verify this element
            </span>
          </div>
        )}

        {/* Editing mode */}
        {isEditing ? (
          <div className="space-y-2">
            <textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="w-full text-[10px] p-2 rounded-md border border-border bg-background font-mono min-h-[80px] resize-y"
              placeholder="Edit the extracted data..."
            />
            <div className="flex gap-1 justify-end">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[10px] px-3 rounded-lg"
                onClick={() => setIsEditing(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-7 text-[10px] px-3 rounded-lg"
                onClick={handleSaveEdit}
              >
                Save
              </Button>
            </div>
          </div>
        ) : (
          /* Action buttons */
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={answer?.confirmed && !answer.correctedValue ? "default" : "outline"}
              className="flex-1 h-8 text-xs rounded-lg gap-1"
              onClick={handleConfirm}
            >
              <Check className="h-3.5 w-3.5" /> Confirm
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1 h-8 text-xs rounded-lg gap-1"
              onClick={handleStartEdit}
            >
              <Edit3 className="h-3.5 w-3.5" /> Edit
            </Button>
            <Button
              size="sm"
              variant={answer && !answer.confirmed ? "destructive" : "outline"}
              className="flex-1 h-8 text-xs rounded-lg gap-1"
              onClick={handleReject}
            >
              <X className="h-3.5 w-3.5" /> Reject
            </Button>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => goTo(currentIndex - 1)}
          disabled={currentIndex <= 0}
          className="h-8 rounded-lg gap-1"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Prev
        </Button>

        {currentIndex >= total - 1 ? (
          <Button
            onClick={handleFinishReview}
            size="sm"
            className="h-8 rounded-lg gap-1 font-semibold"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Finish ({reviewed}/{total})
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => goTo(currentIndex + 1)}
            className="h-8 rounded-lg gap-1"
          >
            Next <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
};

export default ElementReviewPanel;
