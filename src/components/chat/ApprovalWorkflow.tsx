import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Send, CheckCircle, MessageSquare, Clock, Loader2, Bell, Mail, Phone, AlertTriangle } from "lucide-react";
import ShareReviewDialog from "./ShareReviewDialog";

interface ApprovalWorkflowProps {
  projectId: string;
  quoteResult: any;
  elements: { status?: string }[];
  scopeData?: any;
  confidenceScore?: number;
}

interface ReviewComment {
  id: string;
  share_id: string;
  created_at: string;
  content?: string | null;
  author_name?: string | null;
}

interface WorkflowNotification {
  id: string;
  project_id?: string | null;
  created_at: string;
  message?: string | null;
  type?: string | null;
  read?: boolean | null;
  status?: string | null;
  channel?: string | null;
  recipient_name?: string | null;
  recipient_email?: string | null;
}

type WorkflowStage = "estimation_ready" | "sent_to_ben" | "ben_approved" | "sent_to_neel" | "neel_approved" | "sent_to_customer";

const CONFIDENCE_THRESHOLD = 0.85;

const ApprovalWorkflow: React.FC<ApprovalWorkflowProps> = ({ projectId, quoteResult, elements, scopeData, confidenceScore }) => {
  const belowThreshold = confidenceScore !== undefined && confidenceScore < CONFIDENCE_THRESHOLD;
  const [stage, setStage] = useState<WorkflowStage>("estimation_ready");
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [currentReviewType, setCurrentReviewType] = useState<"estimation_review" | "quote_approval" | "customer_quote">("estimation_review");
  const [defaultEmail, setDefaultEmail] = useState("");
  const [defaultName, setDefaultName] = useState("");
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [activeShareId, setActiveShareId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<WorkflowNotification[]>([]);

  // Build review data snapshot
  const buildReviewData = () => {
    const barList = quoteResult?.quote?.bar_list || [];
    const sizeBreakdown = quoteResult?.quote?.size_breakdown || {};
    return {
      bar_list: barList,
      size_breakdown: sizeBreakdown,
      total_weight_lbs: quoteResult?.quote?.total_weight_lbs,
      total_weight_tons: quoteResult?.quote?.total_weight_tons,
      elements_count: elements?.length || 0,
      ready_count: elements?.filter((e) => e.status === "READY").length || 0,
      flagged_count: elements?.filter((e) => e.status === "FLAGGED").length || 0,
      scope: scopeData ? {
        projectName: scopeData.projectName,
        clientName: scopeData.clientName,
        projectType: scopeData.projectType,
        scopeItems: scopeData.scopeItems,
        deviations: scopeData.deviations,
        coatingType: scopeData.coatingType,
      } : null,
      methodology: buildMethodologyExplanation(),
    };
  };

  const buildMethodologyExplanation = () => {
    const barList = quoteResult?.quote?.bar_list || [];
    const grouped: Record<string, any[]> = {};
    for (const b of barList) {
      const t = b.element_type || "OTHER";
      if (!grouped[t]) grouped[t] = [];
      grouped[t].push(b);
    }

    const sections: string[] = [];
    sections.push("## Estimation Methodology\n");
    sections.push("This estimation was generated using the **Atomic Truth Pipeline** — a 9-step AI-powered rebar takeoff process.\n");
    sections.push("### Process:");
    sections.push("1. **PDF Text Extraction** — High-accuracy text and tables extracted from digital PDFs");
    sections.push("2. **Bar-Line-Level Extraction** — Every bar specification recorded without summarization");
    sections.push("3. **Element Detection** — AI identifies structural elements from blueprints");
    sections.push("4. **Scope Verification** — Elements verified against defined scope items");
    sections.push("5. **Validation & Cross-Check** — Quantities and sizes validated for consistency");
    sections.push("6. **Weight Calculation** — Using standard REBAR_UNIT_WEIGHT lookup table\n");
    
    sections.push("### Element Breakdown:");
    for (const [type, bars] of Object.entries(grouped)) {
      const typeWeight = bars.reduce((sum, b) => sum + (b.weight_lbs || 0), 0);
      sections.push(`- **${type}**: ${bars.length} bars, ${typeWeight.toLocaleString()} lbs`);
    }

    return sections.join("\n");
  };

  // Poll for comments on active share
  useEffect(() => {
    if (!activeShareId) return;
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("review_comments")
        .select("*")
        .eq("share_id", activeShareId)
        .order("created_at", { ascending: true });
      if (data) setComments(data);
    }, 10000);
    return () => clearInterval(interval);
  }, [activeShareId]);

  // Check existing shares for this project
  useEffect(() => {
    const checkShares = async () => {
      const { data } = await supabase
        .from("review_shares")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (data && data.length > 0) {
        const latestShare = data[0];
        setActiveShareId(latestShare.id);

        const reviewType = latestShare.review_type || "estimation_review";
        if (reviewType === "estimation_review" && latestShare.status === "commented") {
          setStage("ben_approved");
        } else if (reviewType === "estimation_review") {
          setStage("sent_to_ben");
        } else if (reviewType === "quote_approval" && latestShare.status === "commented") {
          setStage("neel_approved");
        } else if (reviewType === "quote_approval") {
          setStage("sent_to_neel");
        } else if (reviewType === "customer_quote") {
          setStage("sent_to_customer");
        }

        // Load comments
        const { data: commentsData } = await supabase
          .from("review_comments")
          .select("*")
          .eq("share_id", latestShare.id)
          .order("created_at", { ascending: true });
        if (commentsData) setComments(commentsData);
      }
    };
    checkShares();
  }, [projectId]);

  // Load notifications for this project
  useEffect(() => {
    if (!projectId) return;
    const loadNotifications = async () => {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (data) setNotifications(data);
    };
    loadNotifications();
    const interval = setInterval(loadNotifications, 15000);
    return () => clearInterval(interval);
  }, [projectId]);

  const handleSendToBen = () => {
    setCurrentReviewType("estimation_review");
    setDefaultEmail("ben@rebar.shop");
    setDefaultName("Ben");
    setShareDialogOpen(true);
  };

  const handleSendToNeel = () => {
    setCurrentReviewType("quote_approval");
    setDefaultEmail("neel@rebar.shop");
    setDefaultName("Neel");
    setShareDialogOpen(true);
  };

  const handleSendToCustomer = () => {
    setCurrentReviewType("customer_quote");
    setDefaultEmail("");
    setDefaultName("");
    setShareDialogOpen(true);
  };

  const stages = [
    { key: "estimation_ready", label: "Estimation Ready", icon: CheckCircle },
    { key: "sent_to_ben", label: "Sent to Ben", icon: Send },
    { key: "ben_approved", label: "Ben Approved", icon: CheckCircle },
    { key: "sent_to_neel", label: "Sent to Neel", icon: Send },
    { key: "neel_approved", label: "Neel Approved", icon: CheckCircle },
    { key: "sent_to_customer", label: "Sent to Customer", icon: Send },
  ];

  const currentIdx = stages.findIndex((s) => s.key === stage);

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground">Approval Workflow</h3>
        <div className="flex items-center gap-2">
          {confidenceScore !== undefined && (
            <Badge variant={belowThreshold ? "destructive" : "default"} className="text-[10px]">
              Confidence: {(confidenceScore * 100).toFixed(0)}%
            </Badge>
          )}
          <Badge variant="secondary" className="text-[10px]">
            {stages[currentIdx]?.label}
          </Badge>
        </div>
      </div>

      {/* Confidence gate warning */}
      {belowThreshold && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Auto-issue blocked — confidence below {(CONFIDENCE_THRESHOLD * 100).toFixed(0)}%</p>
            <p className="text-muted-foreground mt-0.5">This estimate requires human review before sending to customer. Review flagged elements and resolve uncertainties.</p>
          </div>
        </div>
      )}

      {/* Progress bar */}
      <div className="flex items-center gap-1">
        {stages.map((s, i) => {
          const Icon = s.icon;
          const isComplete = i < currentIdx;
          const isCurrent = i === currentIdx;
          return (
            <React.Fragment key={s.key}>
              <div className={`flex items-center justify-center h-7 w-7 rounded-full text-xs font-bold transition-colors ${
                isComplete ? "bg-primary text-primary-foreground" :
                isCurrent ? "bg-primary/20 text-primary border-2 border-primary" :
                "bg-muted text-muted-foreground"
              }`}>
                {isComplete ? <CheckCircle className="h-3.5 w-3.5" /> : i + 1}
              </div>
              {i < stages.length - 1 && (
                <div className={`flex-1 h-0.5 ${i < currentIdx ? "bg-primary" : "bg-border"}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Comments from reviewers */}
      {comments.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
            <MessageSquare className="h-3 w-3" />
            Reviewer Comments ({comments.length})
          </h4>
          {comments.map((c) => (
            <div key={c.id} className="rounded-lg border border-border bg-muted/50 p-2.5 space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-semibold text-foreground">{c.author_name}</span>
                <span className="text-muted-foreground text-[10px]">
                  {new Date(c.created_at).toLocaleString()}
                </span>
              </div>
              <p className="text-xs text-foreground">{c.content}</p>
            </div>
          ))}
        </div>
      )}

      {/* Notification status badges */}
      {notifications.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {notifications.slice(0, 5).map((n) => (
            <Badge
              key={n.id}
              variant={n.status === "sent" ? "default" : "secondary"}
              className="text-[10px] gap-1"
            >
              {n.channel === "sms" ? <Phone className="h-2.5 w-2.5" /> : <Mail className="h-2.5 w-2.5" />}
              {n.recipient_name || n.recipient_email.split("@")[0]}
              {n.status === "sent" ? " ✓" : n.status === "logged" ? " 📋" : " ⚠"}
            </Badge>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        {stage === "estimation_ready" && (
          <Button onClick={handleSendToBen} size="sm" className="gap-1.5 text-xs">
            <Send className="h-3 w-3" />
            Send to Ben for Review
          </Button>
        )}
        {stage === "ben_approved" && (
          <Button onClick={handleSendToNeel} size="sm" className="gap-1.5 text-xs">
            <Send className="h-3 w-3" />
            Send Quote to Neel
          </Button>
        )}
        {stage === "neel_approved" && (
          <Button onClick={handleSendToCustomer} size="sm" className="gap-1.5 text-xs">
            <Send className="h-3 w-3" />
            Send to Customer
          </Button>
        )}
        {(stage === "sent_to_ben" || stage === "sent_to_neel") && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <Bell className="h-3 w-3 text-primary animate-pulse" />
            Waiting for reviewer response... (notified via {notifications.some(n => n.status === "sent") ? "email" : "in-app"})
          </div>
        )}
        {stage === "sent_to_customer" && (
          <div className="flex items-center gap-2 text-xs text-primary">
            <CheckCircle className="h-3 w-3" />
            Quote sent to customer!
          </div>
        )}
      </div>

      <ShareReviewDialog
        open={shareDialogOpen}
        onOpenChange={(open) => {
          setShareDialogOpen(open);
          if (!open) {
            // Re-check shares after dialog closes
            setTimeout(async () => {
              const { data } = await supabase
                .from("review_shares")
                .select("*")
                .eq("project_id", projectId)
                .order("created_at", { ascending: false })
                .limit(1);
              if (data && data.length > 0) {
                setActiveShareId(data[0].id);
                const rt = data[0].review_type || "estimation_review";
                if (rt === "estimation_review") setStage("sent_to_ben");
                else if (rt === "quote_approval") setStage("sent_to_neel");
                else if (rt === "customer_quote") setStage("sent_to_customer");
              }
            }, 500);
          }
        }}
        projectId={projectId}
        reviewType={currentReviewType}
        reviewData={buildReviewData()}
        defaultEmail={defaultEmail}
        defaultName={defaultName}
      />
    </div>
  );
};

export default ApprovalWorkflow;
