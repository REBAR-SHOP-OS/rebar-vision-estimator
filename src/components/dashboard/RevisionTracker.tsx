import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GitBranch, FileText, ArrowRight } from "lucide-react";

interface SheetRevision {
  id: string;
  sheet_number: string | null;
  sheet_title: string | null;
  revision_code: string | null;
  revision_date: string | null;
  revision_description: string | null;
  discipline: string | null;
  drawing_type: string | null;
  page_number: number | null;
  created_at: string;
  drawing_set_id: string;
}

interface DrawingSet {
  id: string;
  set_name: string | null;
  issue_date: string | null;
  issue_purpose: string | null;
}

const RevisionTracker: React.FC<{ projectId: string; onClose: () => void }> = ({ projectId, onClose }) => {
  const { user } = useAuth();
  const [sets, setSets] = useState<DrawingSet[]>([]);
  const [revisions, setRevisions] = useState<SheetRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSet, setSelectedSet] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      supabase.from("drawing_sets").select("id, set_name, issue_date, issue_purpose").eq("project_id", projectId).order("issue_date", { ascending: false }),
      supabase.from("sheet_revisions").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(500),
    ]).then(([setsRes, revsRes]) => {
      const s = (setsRes.data || []) as DrawingSet[];
      setSets(s);
      setRevisions((revsRes.data || []) as SheetRevision[]);
      if (s.length > 0) setSelectedSet(s[0].id);
      setLoading(false);
    });
  }, [user, projectId]);

  const setRevs = selectedSet ? revisions.filter(r => r.drawing_set_id === selectedSet) : [];

  // Group by sheet_number to show revision chains
  const sheetGroups: Record<string, SheetRevision[]> = {};
  for (const rev of setRevs) {
    const key = rev.sheet_number || rev.id;
    if (!sheetGroups[key]) sheetGroups[key] = [];
    sheetGroups[key].push(rev);
  }
  // Sort each group by revision_date or created_at
  for (const key of Object.keys(sheetGroups)) {
    sheetGroups[key].sort((a, b) => new Date(a.revision_date || a.created_at).getTime() - new Date(b.revision_date || b.created_at).getTime());
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
          <GitBranch className="h-5 w-5 text-primary" /> Revision Tracker
        </h2>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
      </div>

      {loading ? <p className="text-xs text-muted-foreground">Loading...</p> : (
        <>
          {/* Drawing Set Selector */}
          {sets.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {sets.map(s => (
                <button
                  key={s.id}
                  onClick={() => setSelectedSet(s.id)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${selectedSet === s.id ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-accent"}`}
                >
                  {s.set_name || "Set"} {s.issue_date ? `(${new Date(s.issue_date).toLocaleDateString()})` : ""}
                </button>
              ))}
            </div>
          )}

          {/* Sheet Revision Chains */}
          <ScrollArea className="max-h-[500px]">
            <div className="space-y-3">
              {Object.entries(sheetGroups).map(([sheetNum, chain]) => (
                <Card key={sheetNum}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      Sheet {sheetNum}
                      {chain[0]?.sheet_title && <span className="text-muted-foreground font-normal">— {chain[0].sheet_title}</span>}
                      {chain[0]?.discipline && <Badge variant="outline" className="text-[9px]">{chain[0].discipline}</Badge>}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-1 flex-wrap">
                      {chain.map((rev, idx) => (
                        <React.Fragment key={rev.id}>
                          <div className={`text-[10px] px-2 py-1 rounded border ${idx === chain.length - 1 ? "bg-primary/10 border-primary/30 text-primary font-medium" : "border-border text-muted-foreground"}`}>
                            <div className="font-medium">Rev {rev.revision_code || idx}</div>
                            {rev.revision_date && <div className="text-[9px]">{new Date(rev.revision_date).toLocaleDateString()}</div>}
                            {rev.revision_description && <div className="text-[9px] max-w-[120px] truncate">{rev.revision_description}</div>}
                          </div>
                          {idx < chain.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />}
                        </React.Fragment>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
              {Object.keys(sheetGroups).length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-8">No sheet revisions found for this drawing set.</p>
              )}
            </div>
          </ScrollArea>

          {sets.length === 0 && <p className="text-xs text-muted-foreground text-center py-8">No drawing sets found. Upload blueprints to start tracking revisions.</p>}
        </>
      )}
    </div>
  );
};

export default RevisionTracker;
