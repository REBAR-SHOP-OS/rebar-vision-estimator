import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import BlueprintViewer from "@/components/chat/BlueprintViewer";
import { type OverlayElement, type ReviewStatus } from "@/components/chat/DrawingOverlay";

const BlueprintViewerPage: React.FC = () => {
  const navigate = useNavigate();
  const [imageUrl, setImageUrl] = useState<string>("");
  const [elements, setElements] = useState<OverlayElement[]>([]);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [reviewStatuses, setReviewStatuses] = useState<Map<string, ReviewStatus> | undefined>(undefined);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("blueprint-viewer-data");
      if (!raw) {
        navigate("/", { replace: true });
        return;
      }
      const data = JSON.parse(raw);
      setImageUrl(data.imageUrl || "");
      setElements(data.elements || []);
      setSelectedElementId(data.selectedElementId || null);
      if (data.reviewStatuses) {
        setReviewStatuses(new Map(Object.entries(data.reviewStatuses) as [string, ReviewStatus][]));
      }
      // Check URL hash for initial page number (used by provenance links)
      const hash = window.location.hash;
      const pageMatch = hash.match(/page=(\d+)/);
      if (pageMatch) {
        sessionStorage.setItem("blueprint-viewer-initial-page", pageMatch[1]);
      }
      setReady(true);
    } catch {
      navigate("/", { replace: true });
    }
  }, [navigate]);

  const handleClose = useCallback(() => {
    sessionStorage.removeItem("blueprint-viewer-data");
    navigate("/", { replace: true });
  }, [navigate]);

  const handleSelectElement = useCallback((id: string | null) => {
    setSelectedElementId(id);
  }, []);

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-background">
      <BlueprintViewer
        imageUrl={imageUrl}
        elements={elements}
        selectedElementId={selectedElementId}
        onSelectElement={handleSelectElement}
        onClose={handleClose}
        reviewStatuses={reviewStatuses}
      />
    </div>
  );
};

export default BlueprintViewerPage;
