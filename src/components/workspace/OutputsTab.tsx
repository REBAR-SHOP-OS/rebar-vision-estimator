import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Download, Loader2 } from "lucide-react";

interface OutputItem {
  type: string;
  label: string;
  available: boolean;
  count?: number;
}

export default function OutputsTab({ projectId }: { projectId: string }) {
  const [outputs, setOutputs] = useState<OutputItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      supabase.from("estimate_versions").select("id", { count: "exact" }).eq("project_id", projectId),
      supabase.from("shop_drawings").select("id", { count: "exact" }).eq("project_id", projectId),
      supabase.from("validation_issues").select("id", { count: "exact" }).eq("project_id", projectId),
      supabase.from("quote_versions").select("id", { count: "exact" }).eq("project_id", projectId),
    ]).then(([est, shop, issues, quotes]) => {
      setOutputs([
        { type: "estimate", label: "Estimate Summary", available: (est.count || 0) > 0, count: est.count || 0 },
        { type: "shop_drawing", label: "Draft Shop Drawings", available: (shop.count || 0) > 0, count: shop.count || 0 },
        { type: "issues", label: "Issue Report", available: (issues.count || 0) > 0, count: issues.count || 0 },
        { type: "quote", label: "Quote Packages", available: (quotes.count || 0) > 0, count: quotes.count || 0 },
      ]);
      setLoading(false);
    });
  }, [projectId]);

  if (loading) {
    return <div className="flex items-center justify-center h-40"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  }

  return (
    <div className="p-4 md:p-6">
      <h3 className="text-sm font-semibold text-foreground mb-3">Outputs & Exports</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {outputs.map((o) => (
          <Card key={o.type} className={!o.available ? "opacity-50" : ""}>
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">{o.label}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {o.available ? `${o.count} available` : "Not yet generated"}
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" disabled={!o.available} className="text-xs h-8">
                <Download className="h-3.5 w-3.5 mr-1" />Export
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
