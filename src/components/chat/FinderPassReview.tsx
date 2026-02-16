import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, X, Pencil, ChevronLeft, ChevronRight, Eye } from "lucide-react";

export interface FinderCandidate {
  id: string;
  page: number;
  type: string;
  ocrText: string;
  potentialFor: string;
  bbox: [number, number, number, number];
}

export interface ReviewedCandidate extends FinderCandidate {
  status: "confirmed" | "rejected" | "edited";
  editedOcrText?: string;
  editedType?: string;
  editedPotentialFor?: string;
}

const ELEMENT_TYPES = [
  "COLUMN", "FOOTING", "BEAM", "WALL", "SLAB", "PIER", "STAIR",
  "GRADE_BEAM", "RAFT_SLAB", "RETAINING_WALL", "ICF_WALL", "CMU_WALL",
  "WIRE_MESH", "CAGE", "OTHER",
];

const TYPE_COLORS: Record<string, string> = {
  "Detail Title": "bg-blue-500/20 text-blue-300 border-blue-500/30",
  "Local Note": "bg-amber-500/20 text-amber-300 border-amber-500/30",
  "Section Tag": "bg-purple-500/20 text-purple-300 border-purple-500/30",
  "Grid Label": "bg-green-500/20 text-green-300 border-green-500/30",
  "Dimension": "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
};

interface FinderPassReviewProps {
  candidates: FinderCandidate[];
  onComplete: (reviewed: ReviewedCandidate[]) => void;
  onCancel: () => void;
  onSelectElement: (id: string) => void;
}

const FinderPassReview: React.FC<FinderPassReviewProps> = ({
  candidates,
  onComplete,
  onCancel,
  onSelectElement,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [reviewed, setReviewed] = useState<Map<string, ReviewedCandidate>>(new Map());
  const [editMode, setEditMode] = useState(false);
  const [editOcrText, setEditOcrText] = useState("");
  const [editType, setEditType] = useState("");
  const [editPotentialFor, setEditPotentialFor] = useState("");

  const current = candidates[currentIndex];
  const reviewedCount = reviewed.size;
  const progress = candidates.length > 0 ? (reviewedCount / candidates.length) * 100 : 0;

  // Sync with drawing when stepping
  useEffect(() => {
    if (current) {
      onSelectElement(current.id);
    }
  }, [currentIndex, current, onSelectElement]);

  // Initialize edit fields when entering edit mode or changing candidate
  useEffect(() => {
    if (current) {
      const existing = reviewed.get(current.id);
      setEditOcrText(existing?.editedOcrText ?? current.ocrText);
      setEditType(existing?.editedType ?? current.type);
      setEditPotentialFor(existing?.editedPotentialFor ?? current.potentialFor);
    }
  }, [currentIndex, current, editMode]);

  const handleConfirm = () => {
    if (!current) return;
    const entry: ReviewedCandidate = { ...current, status: "confirmed" };
    setReviewed((prev) => new Map(prev).set(current.id, entry));
    setEditMode(false);
    advanceNext();
  };

  const handleReject = () => {
    if (!current) return;
    const entry: ReviewedCandidate = { ...current, status: "rejected" };
    setReviewed((prev) => new Map(prev).set(current.id, entry));
    setEditMode(false);
    advanceNext();
  };

  const handleSaveEdit = () => {
    if (!current) return;
    const entry: ReviewedCandidate = {
      ...current,
      status: "edited",
      editedOcrText: editOcrText,
      editedType: editType,
      editedPotentialFor: editPotentialFor,
    };
    setReviewed((prev) => new Map(prev).set(current.id, entry));
    setEditMode(false);
    advanceNext();
  };

  const advanceNext = () => {
    // Find next unreviewed
    for (let i = currentIndex + 1; i < candidates.length; i++) {
      if (!reviewed.has(candidates[i].id)) {
        setCurrentIndex(i);
        return;
      }
    }
    // Wrap around
    for (let i = 0; i < currentIndex; i++) {
      if (!reviewed.has(candidates[i].id)) {
        setCurrentIndex(i);
        return;
      }
    }
    // All reviewed — stay on current
  };

  const allDone = reviewedCount === candidates.length;

  if (!current) return null;

  const existingReview = reviewed.get(current.id);
  const statusBadge = existingReview ? (
    <Badge
      className={
        existingReview.status === "confirmed"
          ? "bg-green-500/20 text-green-400 border-green-500/30"
          : existingReview.status === "rejected"
          ? "bg-red-500/20 text-red-400 border-red-500/30"
          : "bg-amber-500/20 text-amber-400 border-amber-500/30"
      }
    >
      {existingReview.status}
    </Badge>
  ) : null;

  const typeColor = TYPE_COLORS[current.type] || "bg-muted text-muted-foreground border-border";

  return (
    <Card className="border-primary/30 bg-card">
      <CardHeader className="pb-3 pt-4 px-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Review Finder Pass</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {reviewedCount}/{candidates.length} reviewed
          </span>
        </div>
        <Progress value={progress} className="h-1.5 mt-2" />
      </CardHeader>

      <CardContent className="px-4 pb-4 space-y-3">
        {/* Navigation */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
            disabled={currentIndex === 0}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs font-medium text-muted-foreground">
            #{currentIndex + 1} of {candidates.length}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentIndex(Math.min(candidates.length - 1, currentIndex + 1))}
            disabled={currentIndex === candidates.length - 1}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Candidate Card */}
        <div className="rounded-lg border border-border bg-background p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={typeColor}>
              {current.type}
            </Badge>
            <Badge variant="secondary" className="font-mono text-[10px]">
              Page {current.page}
            </Badge>
            {statusBadge}
          </div>

          {editMode ? (
            <div className="space-y-2">
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider">OCR Text</label>
                <Input
                  value={editOcrText}
                  onChange={(e) => setEditOcrText(e.target.value)}
                  className="h-8 text-xs font-mono mt-1"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Potential For</label>
                <Input
                  value={editPotentialFor}
                  onChange={(e) => setEditPotentialFor(e.target.value)}
                  className="h-8 text-xs font-mono mt-1"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Element Type</label>
                <Select value={editType} onValueChange={setEditType}>
                  <SelectTrigger className="h-8 text-xs mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ELEMENT_TYPES.map((t) => (
                      <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="font-mono text-xs bg-muted/50 rounded px-2 py-1.5 break-all">
                {existingReview?.editedOcrText ?? current.ocrText}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground">→</span>
                <Badge variant="default" className="text-[10px]">
                  {existingReview?.editedPotentialFor ?? current.potentialFor}
                </Badge>
              </div>
            </div>
          )}

          {/* Bbox reference */}
          <div className="text-[9px] text-muted-foreground/60 font-mono">
            bbox: [{current.bbox.join(", ")}]
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          {editMode ? (
            <>
              <Button size="sm" onClick={handleSaveEdit} className="flex-1 bg-amber-600 hover:bg-amber-700 text-white">
                <Check className="h-3.5 w-3.5 mr-1" /> Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditMode(false)} className="flex-1">
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" onClick={handleConfirm} className="flex-1 bg-green-600 hover:bg-green-700 text-white">
                <Check className="h-3.5 w-3.5 mr-1" /> Confirm
              </Button>
              <Button size="sm" onClick={() => setEditMode(true)} className="flex-1 bg-amber-600 hover:bg-amber-700 text-white">
                <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
              </Button>
              <Button size="sm" onClick={handleReject} variant="destructive" className="flex-1">
                <X className="h-3.5 w-3.5 mr-1" /> Reject
              </Button>
            </>
          )}
        </div>

        {/* Complete / Cancel */}
        {allDone && (
          <Button
            onClick={() => onComplete(Array.from(reviewed.values()))}
            className="w-full"
          >
            ✅ Finish Review ({reviewed.size} items)
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onCancel} className="w-full text-xs text-muted-foreground">
          Skip Review
        </Button>
      </CardContent>
    </Card>
  );
};

export default FinderPassReview;
