import React from "react";
import { Badge } from "@/components/ui/badge";
import { FileText, Hash, Layers, ShieldCheck, ShieldAlert, AlertTriangle, GitBranch } from "lucide-react";

export interface SearchResult {
  id: string;
  project_id: string;
  logical_drawing_id: string | null;
  page_number: number | null;
  sheet_id: string | null;
  discipline: string | null;
  drawing_type: string | null;
  revision_label: string | null;
  issue_status: string | null;
  crm_deal_id: string | null;
  bar_marks: string[];
  project_name: string | null;
  headline: string | null;
  rank: number;
  created_at: string;
  confidence?: number;
  sha256?: string | null;
  source_system?: string | null;
  quality_flags?: string[] | null;
  needs_review?: boolean;
  revision_chain_id?: string | null;
}

interface Props {
  result: SearchResult;
  onClick: (projectId: string) => void;
  onRevisionChainClick?: (chainId: string) => void;
}

const SearchResultCard: React.FC<Props> = ({ result, onClick, onRevisionChainClick }) => {
  const confidence = result.confidence ?? 1.0;
  const isLowConfidence = confidence < 0.7;
  const flags = result.quality_flags || [];

  return (
    <div
      className="group rounded-lg border border-border bg-card p-3 space-y-2 cursor-pointer hover:border-primary/40 hover:shadow-sm transition-all"
      onClick={() => onClick(result.project_id)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 text-primary flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {result.sheet_id || "Unknown Sheet"}
              {result.revision_label && <span className="text-muted-foreground ml-1">Rev {result.revision_label}</span>}
            </p>
            <p className="text-[11px] text-muted-foreground truncate">{result.project_name || "Unknown Project"}</p>
          </div>
        </div>
        <div className="flex gap-1 flex-shrink-0 items-center">
          <span className={`flex items-center ${isLowConfidence ? "text-destructive" : "text-muted-foreground"}`}>
            {isLowConfidence ? <ShieldAlert className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
          </span>
          {result.needs_review && (
            <Badge variant="destructive" className="text-[8px] px-1 py-0">Review</Badge>
          )}
          {result.discipline && (
            <Badge variant="outline" className="text-[9px] capitalize">{result.discipline}</Badge>
          )}
          {result.drawing_type && (
            <Badge variant="secondary" className="text-[9px] capitalize">{result.drawing_type?.replace(/_/g, " ")}</Badge>
          )}
        </div>
      </div>

      {/* Quality flags */}
      {flags.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <AlertTriangle className="h-3 w-3 text-amber-500" />
          {flags.map((f) => (
            <Badge key={f} variant="outline" className="text-[8px] text-amber-600 border-amber-300">
              {f.replace(/_/g, " ")}
            </Badge>
          ))}
        </div>
      )}

      {result.bar_marks.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <Hash className="h-3 w-3 text-muted-foreground" />
          {result.bar_marks.slice(0, 8).map((bm) => (
            <Badge key={bm} variant="outline" className="text-[9px] font-mono">{bm}</Badge>
          ))}
          {result.bar_marks.length > 8 && (
            <span className="text-[9px] text-muted-foreground">+{result.bar_marks.length - 8}</span>
          )}
        </div>
      )}

      {result.headline && (
        <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
          {result.headline.replace(/<[^>]+>/g, "")}
        </p>
      )}

      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        {result.page_number && <span>Page {result.page_number}</span>}
        {result.crm_deal_id && (
          <span className="flex items-center gap-0.5">
            <Layers className="h-2.5 w-2.5" /> CRM: {result.crm_deal_id}
          </span>
        )}
        {result.source_system && result.source_system !== "upload" && (
          <Badge variant="outline" className="text-[8px]">{result.source_system}</Badge>
        )}
        {result.revision_chain_id && onRevisionChainClick && (
          <button
            onClick={(e) => { e.stopPropagation(); onRevisionChainClick(result.revision_chain_id!); }}
            className="flex items-center gap-0.5 text-primary hover:underline"
          >
            <GitBranch className="h-2.5 w-2.5" /> Revisions
          </button>
        )}
        <span className={`${isLowConfidence ? "text-destructive font-medium" : ""}`}>
          {(confidence * 100).toFixed(0)}%
        </span>
        {result.rank > 0 && <span className="ml-auto">Score: {result.rank.toFixed(3)}</span>}
      </div>
    </div>
  );
};

export default SearchResultCard;
