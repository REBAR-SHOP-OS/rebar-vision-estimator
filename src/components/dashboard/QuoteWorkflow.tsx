import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FileText, Plus, Send, ExternalLink, Download, Building2 } from "lucide-react";
import { toast } from "sonner";
import { exportQuotePdf } from "@/lib/quote-pdf-export";

interface QuoteVersion {
  id: string;
  version_number: number;
  quoted_price: number | null;
  status: string | null;
  created_at: string;
  terms_text: string | null;
  exclusions_text: string | null;
  currency: string | null;
  estimate_version_id: string;
}

const QuoteWorkflow: React.FC<{ projectId: string; onClose: () => void }> = ({ projectId, onClose }) => {
  const { user } = useAuth();
  const [quotes, setQuotes] = useState<QuoteVersion[]>([]);
  const [estimates, setEstimates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // New quote form
  const [selectedEstimate, setSelectedEstimate] = useState("");
  const [quotedPrice, setQuotedPrice] = useState("");
  const [termsText, setTermsText] = useState("Standard terms apply. Quote valid for 30 days.");
  const [exclusionsText, setExclusionsText] = useState("");

  useEffect(() => {
    if (!user) return;
    Promise.all([
      supabase.from("quote_versions").select("*").eq("project_id", projectId).order("version_number", { ascending: false }),
      supabase.from("estimate_versions").select("id, version_number, total_estimated_cost, status, created_at").eq("project_id", projectId).order("version_number", { ascending: false }),
    ]).then(([quotesRes, estimatesRes]) => {
      setQuotes((quotesRes.data as QuoteVersion[]) || []);
      setEstimates(estimatesRes.data || []);
      if (estimatesRes.data && estimatesRes.data.length > 0) {
        setSelectedEstimate(estimatesRes.data[0].id);
      }
      setLoading(false);
    });
  }, [user, projectId]);

  const createQuote = async () => {
    if (!user || !selectedEstimate) return;
    setCreating(true);

    const nextVersion = quotes.length > 0 ? Math.max(...quotes.map(q => q.version_number)) + 1 : 1;

    const { data, error } = await supabase.from("quote_versions").insert({
      project_id: projectId,
      user_id: user.id,
      estimate_version_id: selectedEstimate,
      version_number: nextVersion,
      quoted_price: quotedPrice ? parseFloat(quotedPrice) : null,
      terms_text: termsText || null,
      exclusions_text: exclusionsText || null,
      status: "draft",
      currency: "CAD",
    }).select().single();

    if (error) {
      toast.error("Failed to create quote");
    } else {
      toast.success(`Quote v${nextVersion} created`);
      setQuotes(prev => [data as QuoteVersion, ...prev]);

      // Log to audit
      await supabase.from("audit_log").insert({
        user_id: user.id,
        project_id: projectId,
        action: "quote_created",
        details: { version_number: nextVersion, estimate_version_id: selectedEstimate },
      });
    }
    setCreating(false);
  };

  const issueQuote = async (quoteId: string) => {
    const { error } = await supabase.from("quote_versions")
      .update({ status: "issued", issued_at: new Date().toISOString() })
      .eq("id", quoteId);

    if (error) {
      toast.error("Failed to issue quote");
    } else {
      toast.success("Quote issued");
      setQuotes(prev => prev.map(q => q.id === quoteId ? { ...q, status: "issued" } : q));
    }
  };

  const sendForReview = async (quoteId: string) => {
    // Create a review share link
    if (!user) return;
    const quote = quotes.find(q => q.id === quoteId);
    if (!quote) return;

    const shareToken = crypto.randomUUID();
    const { error } = await supabase.from("review_shares").insert({
      project_id: projectId,
      user_id: user.id,
      reviewer_email: "reviewer@example.com",
      share_token: shareToken,
      review_type: "quote_review",
      review_data: { quote_id: quoteId, quoted_price: quote.quoted_price },
      status: "pending",
    });

    if (error) {
      toast.error("Failed to create review link");
    } else {
      const reviewUrl = `${window.location.origin}/review/${shareToken}`;
      navigator.clipboard.writeText(reviewUrl);
      toast.success("Review link copied to clipboard!");
    }
  };

  const handlePdfExport = async (q: QuoteVersion) => {
    const { data: project } = await supabase.from("projects").select("name, client_name, address").eq("id", projectId).single();
    const { data: est } = await supabase.from("estimate_versions").select("version_number, total_estimated_cost").eq("id", q.estimate_version_id).single();
    await exportQuotePdf({
      quote: q,
      projectName: project?.name || "Project",
      clientName: project?.client_name || undefined,
      address: project?.address || undefined,
      estimateSummary: est ? { total_estimated_cost: est.total_estimated_cost, version_number: est.version_number } : undefined,
    });
  };

  const pushToCrm = async (quoteId: string) => {
    const { data: deals } = await supabase.from("crm_deals").select("crm_deal_id").limit(1);
    if (!deals || deals.length === 0) { toast.error("No CRM deal linked"); return; }
    const { data, error } = await supabase.functions.invoke("push-quote-to-crm", {
      body: { quote_id: quoteId, crm_deal_id: deals[0].crm_deal_id },
    });
    if (error) { toast.error("CRM push failed"); return; }
    toast.success(`Quote pushed to CRM (${data?.method || "done"})`);
  };

  const fmtDate = (ts: string) => new Date(ts).toLocaleDateString();
  const fmtPrice = (p: number | null, currency: string | null) =>
    p != null ? `${currency || "CAD"} $${p.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—";

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          Quote Workflow
        </h2>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : (
        <>
          {/* Create New Quote */}
          <Card className="border-primary/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Plus className="h-4 w-4" /> New Quote
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-[10px] text-muted-foreground font-medium">Based on Estimate</label>
                <select
                  value={selectedEstimate}
                  onChange={(e) => setSelectedEstimate(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground mt-0.5"
                >
                  {estimates.map((est) => (
                    <option key={est.id} value={est.id}>
                      v{est.version_number} — {fmtDate(est.created_at)} ({est.status})
                    </option>
                  ))
                  }
                </select>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-medium">Quoted Price (CAD)</label>
                <Input
                  type="number"
                  value={quotedPrice}
                  onChange={(e) => setQuotedPrice(e.target.value)}
                  placeholder="0.00"
                  className="text-xs mt-0.5"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-medium">Terms</label>
                <Textarea
                  value={termsText}
                  onChange={(e) => setTermsText(e.target.value)}
                  className="text-xs mt-0.5 min-h-[60px]"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-medium">Exclusions</label>
                <Textarea
                  value={exclusionsText}
                  onChange={(e) => setExclusionsText(e.target.value)}
                  placeholder="List any exclusions..."
                  className="text-xs mt-0.5 min-h-[40px]"
                />
              </div>
              <Button onClick={createQuote} disabled={creating || !selectedEstimate} size="sm" className="w-full gap-2">
                <Plus className="h-3.5 w-3.5" />
                Create Quote
              </Button>
            </CardContent>
          </Card>

          {/* Existing Quotes */}
          <Card className="border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Quotes ({quotes.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[300px]">
                <div className="space-y-2">
                  {quotes.map((q) => (
                    <div key={q.id} className="rounded-lg border border-border p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[9px]">v{q.version_number}</Badge>
                        <Badge className={`text-[9px] ${
                          q.status === "issued" ? "bg-primary/15 text-primary" :
                          q.status === "accepted" ? "bg-green-500/15 text-green-600" :
                          "bg-muted text-muted-foreground"
                        }`}>{q.status}</Badge>
                        <span className="text-xs font-medium text-foreground ml-auto">
                          {fmtPrice(q.quoted_price, q.currency)}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground">{fmtDate(q.created_at)}</p>
                      {q.terms_text && <p className="text-[10px] text-muted-foreground truncate">{q.terms_text}</p>}
                      <div className="flex gap-2">
                        {q.status === "draft" && (
                          <Button size="sm" variant="outline" className="text-[10px] h-6 gap-1" onClick={() => issueQuote(q.id)}>
                            <Send className="h-3 w-3" /> Issue
                          </Button>
                        )}
                        <Button size="sm" variant="outline" className="text-[10px] h-6 gap-1" onClick={() => sendForReview(q.id)}>
                          <ExternalLink className="h-3 w-3" /> Share
                        </Button>
                        <Button size="sm" variant="outline" className="text-[10px] h-6 gap-1" onClick={() => handlePdfExport(q)}>
                          <Download className="h-3 w-3" /> PDF
                        </Button>
                        <Button size="sm" variant="outline" className="text-[10px] h-6 gap-1" onClick={() => pushToCrm(q.id)}>
                          <Building2 className="h-3 w-3" /> CRM
                        </Button>
                      </div>
                    </div>
                  ))
                  }
                  {quotes.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-8">No quotes yet. Create one above.</p>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default QuoteWorkflow;
