import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import PdfRenderer from "@/components/chat/PdfRenderer";

type TileStatus = "complete" | "partial" | "attention";
type Discipline = "Structural" | "Architectural" | "Other";

interface SheetTileProps {
  active: boolean;
  pageNumber: number | null;
  sheetNumber: string | null;
  discipline: Discipline;
  status: TileStatus;
  sourceFileName: string | null;
  sourceFilePath: string | null;
  onSelect: () => void;
}

function chipForStatus(status: TileStatus) {
  if (status === "complete") {
    return {
      label: "✓",
      className:
        "border-[hsl(var(--status-supported))]/50 bg-[hsl(var(--status-supported))]/10 text-[hsl(var(--status-supported))]",
    };
  }
  if (status === "partial") {
    return {
      label: "…",
      className:
        "border-[hsl(var(--status-inferred))]/50 bg-[hsl(var(--status-inferred))]/10 text-[hsl(var(--status-inferred))]",
    };
  }
  return {
    label: "!",
    className:
      "border-[hsl(var(--status-blocked))]/50 bg-[hsl(var(--status-blocked))]/10 text-[hsl(var(--status-blocked))]",
  };
}

function disciplineClass(discipline: Discipline) {
  if (discipline === "Structural") return "border-primary/40 text-primary";
  if (discipline === "Architectural") return "border-border text-foreground";
  return "border-border text-muted-foreground";
}

export default function SheetTile({
  active,
  pageNumber,
  sheetNumber,
  discipline,
  status,
  sourceFileName,
  sourceFilePath,
  onSelect,
}: SheetTileProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [thumbSrc, setThumbSrc] = useState<string | null>(null);
  const ref = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setIsVisible(true);
        }
      },
      { rootMargin: "120px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!isVisible || !sourceFilePath) return;
    (async () => {
      const { data } = await supabase.storage.from("blueprints").createSignedUrl(sourceFilePath, 3600);
      if (!cancelled) setSignedUrl(data?.signedUrl || null);
    })();
    return () => {
      cancelled = true;
    };
  }, [isVisible, sourceFilePath]);

  const statusChip = chipForStatus(status);
  const isPdf = /\.pdf$/i.test(sourceFileName || "");

  return (
    <button
      type="button"
      ref={ref}
      onClick={onSelect}
      className={`w-full border px-2.5 py-2 text-left transition-colors ${
        active
          ? "border-primary bg-primary/8 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.15)]"
          : "border-border bg-background hover:bg-accent/30"
      }`}
      style={{ borderRadius: 4 }}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-semibold text-foreground">
            {sheetNumber || `Page ${pageNumber ?? "—"}`}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Page {pageNumber ?? "—"}
          </div>
        </div>
        <span className={`inline-flex h-6 min-w-6 items-center justify-center border px-1.5 text-[11px] font-semibold ${statusChip.className}`}>
          {statusChip.label}
        </span>
      </div>

      <div className="relative mb-2 aspect-[4/3] overflow-hidden border border-border bg-muted/20">
        {isVisible && signedUrl && isPdf && (
          <PdfRenderer
            url={signedUrl}
            currentPage={pageNumber || 1}
            scale={0.65}
            onPageRendered={(image) => setThumbSrc(image)}
          />
        )}
        {thumbSrc ? (
          <img src={thumbSrc} alt="" className="h-full w-full object-cover object-top" />
        ) : (
          <div className="flex h-full items-center justify-center px-3 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {isVisible ? "Loading thumb" : "Thumb idle"}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] ${disciplineClass(discipline)}`}>
          {discipline}
        </span>
        <span className="truncate font-mono text-[10px] text-muted-foreground">
          {sourceFileName || "No source"}
        </span>
      </div>
    </button>
  );
}
