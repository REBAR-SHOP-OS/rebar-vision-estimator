import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, CheckCircle2, AlertTriangle, Edit3, Check, X } from "lucide-react";

interface ReviewElement {
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

interface ReviewAnswer {
  element_id: string;
  confirmed: boolean;
  correctedValue?: string;
  field?: string;
}

interface PageReviewPanelProps {
  elements: ReviewElement[];
  totalPages: number;
  onComplete: (answers: ReviewAnswer[]) => void;
  onCancel: () => void;
  onPageChange?: (page: number) => void;
  onSelectElement?: (elementId: string) => void;
}

const PageReviewPanel: React.FC<PageReviewPanelProps> = ({
  elements,
  totalPages,
  onComplete,
  onCancel,
  onPageChange,
  onSelectElement,
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [answers, setAnswers] = useState<Map<string, ReviewAnswer>>(new Map());
  const [editingElement, setEditingElement] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [reviewComplete, setReviewComplete] = useState(false);

  const pageCount = Math.max(totalPages, 1);

  // Group elements by page
  const pageElements = useMemo(() => {
    return elements.filter((el) => {
      const elPage = el.regions?.tag_region?.page_number || 1;
      return elPage === currentPage;
    });
  }, [elements, currentPage]);

  // Elements needing review (confidence < 100%)
  const needsReview = useMemo(() => {
    return pageElements.filter(
      (el) => !el.extraction?.confidence || el.extraction.confidence < 1.0
    );
  }, [pageElements]);

  const allElementsOnPage = pageElements.length;
  const reviewedOnPage = pageElements.filter((el) => answers.has(el.element_id)).length;
  const totalReviewed = answers.size;
  const totalElements = elements.length;
  const progressPercent = totalElements > 0 ? (totalReviewed / totalElements) * 100 : 0;

  const goToPage = (page: number) => {
    const clamped = Math.max(1, Math.min(pageCount, page));
    setCurrentPage(clamped);
    onPageChange?.(clamped);
  };

  const handleConfirm = (el: ReviewElement) => {
    setAnswers((prev) => {
      const next = new Map(prev);
      next.set(el.element_id, { element_id: el.element_id, confirmed: true });
      return next;
    });
  };

  const handleReject = (el: ReviewElement) => {
    setAnswers((prev) => {
      const next = new Map(prev);
      next.set(el.element_id, { element_id: el.element_id, confirmed: false });
      return next;
    });
  };

  const handleStartEdit = (el: ReviewElement) => {
    setEditingElement(el.element_id);
    const truth = el.extraction?.truth;
    setEditValue(truth ? JSON.stringify(truth, null, 2) : "");
  };

  const handleSaveEdit = (el: ReviewElement) => {
    setAnswers((prev) => {
      const next = new Map(prev);
      next.set(el.element_id, {
        element_id: el.element_id,
        confirmed: true,
        correctedValue: editValue,
        field: "truth",
      });
      return next;
    });
    setEditingElement(null);
    setEditValue("");
  };

  const handleFinishReview = () => {
    setReviewComplete(true);
    onComplete(Array.from(answers.values()));
  };

  const isLastPage = currentPage >= pageCount;

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

  return (
    <div className="space-y-3 p-4 rounded-xl border-2 border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground">Page-by-Page Review</h3>
        <Button variant="ghost" size="sm" onClick={onCancel} className="text-xs h-7">
          <X className="h-3 w-3 mr-1" /> Cancel
        </Button>
      </div>

      {/* Progress */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>Page {currentPage} of {pageCount}</span>
          <span>{totalReviewed} / {totalElements} elements reviewed</span>
        </div>
        <Progress value={progressPercent} className="h-2" />
      </div>

      {/* Page navigation */}
      <div className="flex items-center justify-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => goToPage(currentPage - 1)}
          disabled={currentPage <= 1}
          className="h-8 rounded-lg"
        >
          <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Previous
        </Button>
        <span className="text-xs font-semibold text-foreground px-3">
          Page {currentPage}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => goToPage(currentPage + 1)}
          disabled={isLastPage}
          className="h-8 rounded-lg"
        >
          Next <ChevronRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      </div>

      {/* Elements on this page */}
      {pageElements.length === 0 ? (
        <div className="text-center py-6 text-xs text-muted-foreground">
          No elements found on this page
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
            {allElementsOnPage} element{allElementsOnPage !== 1 ? "s" : ""} on this page
            {needsReview.length > 0 && ` • ${needsReview.length} need${needsReview.length !== 1 ? "" : "s"} review`}
          </p>
          {pageElements.map((el) => {
            const confidence = el.extraction?.confidence || 0;
            const needsConfirmation = confidence < 1.0;
            const answer = answers.get(el.element_id);
            const isEditing = editingElement === el.element_id;
            const truth = el.extraction?.truth as any;

            return (
              <div
                key={el.element_id}
                className={`p-3 rounded-lg border transition-all ${
                  answer
                    ? answer.confirmed
                      ? "border-primary/30 bg-primary/5"
                      : "border-destructive/30 bg-destructive/5"
                    : needsConfirmation
                    ? "border-amber-500/30 bg-amber-500/5"
                    : "border-border bg-card"
                }`}
                onClick={() => onSelectElement?.(el.element_id)}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-foreground">{el.element_id}</span>
                    <Badge variant="outline" className="text-[9px] rounded-md">{el.element_type}</Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    {answer && (
                      <Badge
                        variant={answer.confirmed ? "secondary" : "destructive"}
                        className="text-[9px] rounded-md"
                      >
                        {answer.correctedValue ? "Corrected" : answer.confirmed ? "Confirmed" : "Rejected"}
                      </Badge>
                    )}
                    <span className="text-[10px] font-semibold text-muted-foreground">
                      {Math.round(confidence * 100)}%
                    </span>
                  </div>
                </div>

                {/* Truth summary */}
                {truth && (
                  <div className="text-[10px] text-muted-foreground mb-2">
                    {truth.vertical_bars && (
                      <span className="mr-2">
                        {truth.vertical_bars.qty}× {truth.vertical_bars.size} verticals
                      </span>
                    )}
                    {truth.ties && (
                      <span>
                        {truth.ties.size} ties @{truth.ties.spacing_mm}mm
                      </span>
                    )}
                    {!truth.vertical_bars && !truth.ties && (
                      <span className="italic">Parsed from tabular data</span>
                    )}
                  </div>
                )}

                {/* Confirmation prompt for low confidence */}
                {needsConfirmation && !answer && !isEditing && (
                  <div className="flex items-center gap-2 mt-2">
                    <AlertTriangle className="h-3 w-3 text-amber-500 flex-shrink-0" />
                    <span className="text-[10px] text-amber-600 dark:text-amber-400 flex-1">
                      Confidence {Math.round(confidence * 100)}% — Is this correct?
                    </span>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] px-2 rounded-md"
                        onClick={(e) => { e.stopPropagation(); handleConfirm(el); }}
                      >
                        <Check className="h-3 w-3 mr-0.5" /> Yes
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] px-2 rounded-md"
                        onClick={(e) => { e.stopPropagation(); handleStartEdit(el); }}
                      >
                        <Edit3 className="h-3 w-3 mr-0.5" /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] px-2 rounded-md text-destructive"
                        onClick={(e) => { e.stopPropagation(); handleReject(el); }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                )}

                {/* Already high confidence - auto-confirm option */}
                {!needsConfirmation && !answer && (
                  <div className="flex items-center gap-2 mt-2">
                    <CheckCircle2 className="h-3 w-3 text-primary flex-shrink-0" />
                    <span className="text-[10px] text-primary flex-1">High confidence</span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] px-2 rounded-md"
                      onClick={(e) => { e.stopPropagation(); handleConfirm(el); }}
                    >
                      <Check className="h-3 w-3 mr-0.5" /> Confirm
                    </Button>
                  </div>
                )}

                {/* Editing mode */}
                {isEditing && (
                  <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                    <textarea
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="w-full text-[10px] p-2 rounded-md border border-border bg-background font-mono min-h-[60px] resize-y"
                      placeholder="Edit the extracted data..."
                    />
                    <div className="flex gap-1 justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] px-2 rounded-md"
                        onClick={() => setEditingElement(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="h-6 text-[10px] px-2 rounded-md"
                        onClick={() => handleSaveEdit(el)}
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Finish / Next actions */}
      {isLastPage ? (
        <Button
          onClick={handleFinishReview}
          className="w-full rounded-xl font-semibold gap-2"
        >
          <CheckCircle2 className="h-4 w-4" />
          Finish Review ({totalReviewed}/{totalElements} reviewed)
        </Button>
      ) : (
        <Button
          variant="outline"
          onClick={() => goToPage(currentPage + 1)}
          className="w-full rounded-xl font-semibold gap-2"
        >
          Continue to Page {currentPage + 1}
          <ChevronRight className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
};

export default PageReviewPanel;
