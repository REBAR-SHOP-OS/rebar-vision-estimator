import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Loader2,
  Paperclip,
  MessageSquare,
  Zap,
  BookOpen,
  ExternalLink,
  FileText,
  User,
  Calendar,
  DollarSign,
} from "lucide-react";
import { toast } from "sonner";
import type { LeadAttachment } from "./CrmSyncPanel";

interface LeadDetailPanelProps {
  leadId: string | null;
  onClose: () => void;
  onStartEstimationWithFiles?: (projectId: string, files: LeadAttachment[]) => void;
}

interface CrmLeadRecord {
  id?: string | number;
  title?: string;
  customers?: { company_name?: string; name?: string } | null;
  expected_value?: number;
  created_at?: string;
  stage?: string;
  priority?: string;
}

interface CrmMessage {
  author?: string;
  user_name?: string;
  created_at?: string;
  body?: string;
  content?: string;
  message?: string;
}

interface LeadDetail {
  lead: CrmLeadRecord;
  attachments: LeadAttachment[];
  messages: CrmMessage[];
  messages_table: string;
}

const LeadDetailPanel: React.FC<LeadDetailPanelProps> = ({
  leadId,
  onClose,
  onStartEstimationWithFiles,
}) => {
  const { user } = useAuth();
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [learning, setLearning] = useState(false);

  useEffect(() => {
    if (leadId) {
      fetchDetails(leadId);
    } else {
      setDetail(null);
    }
  }, [leadId]);

  const fetchDetails = async (id: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-lead-details", {
        body: { lead_id: id },
      });
      if (error) {
        toast.error("Failed to fetch lead details");
        console.error(error);
      } else {
        setDetail(data);
      }
    } catch (err) {
      toast.error("Failed to connect");
      console.error(err);
    }
    setLoading(false);
  };

  const learnFromLead = async () => {
    if (!user || !leadId) return;
    setLearning(true);
    try {
      const { data, error } = await supabase.functions.invoke("learn-from-pipeline", {
        body: { lead_id: leadId, user_id: user.id },
      });
      if (error) {
        toast.error("Failed to learn from lead");
      } else {
        toast.success(`Learned ${data.learned} case(s) from this lead`);
      }
    } catch (err) {
      toast.error("Learning failed");
    }
    setLearning(false);
  };

  const useAsContext = async () => {
    if (!user || !detail) return;
    const lead = detail.lead;
    const projectName = lead.title || lead.customers?.company_name || "Pipeline Lead";

    const { data: project, error } = await supabase
      .from("projects")
      .insert({ user_id: user.id, name: projectName, client_name: lead.customers?.company_name || null })
      .select()
      .single();

    if (error) {
      toast.error("Failed to create project");
      return;
    }

    await supabase.from("estimate_outcomes").insert({
      user_id: user.id,
      project_id: project.id,
      crm_deal_id: String(lead.id),
    });

    const files: LeadAttachment[] = detail.attachments.map((a) => ({
      name: a.name,
      size: a.size,
      mimeType: a.mimeType,
      url: a.url,
    }));

    if (onStartEstimationWithFiles) {
      onStartEstimationWithFiles(project.id, files);
    }
    toast.success(`Project "${projectName}" created — starting estimation`);
    onClose();
  };

  const formatDate = (d: string | null) => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
  };

  return (
    <Sheet open={!!leadId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="text-base">Lead Details</SheetTitle>
          <SheetDescription className="text-xs">
            Full lead payload from pipeline
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading lead details...</span>
          </div>
        ) : !detail ? (
          <div className="text-center py-16 text-muted-foreground text-sm">
            No data loaded
          </div>
        ) : (
          <ScrollArea className="h-[calc(100vh-140px)] mt-4 pr-2">
            {/* Lead Info */}
            <div className="space-y-3 mb-4">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" /> Lead Info
              </h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Title</span>
                  <p className="font-medium text-foreground">{detail.lead.title || "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Company</span>
                  <p className="font-medium text-foreground">
                    {detail.lead.customers?.company_name || detail.lead.customers?.name || "—"}
                  </p>
                </div>
                <div className="flex items-start gap-1">
                  <DollarSign className="h-3 w-3 mt-0.5 text-muted-foreground" />
                  <div>
                    <span className="text-muted-foreground">Value</span>
                    <p className="font-medium text-foreground">
                      {detail.lead.expected_value ? `$${Number(detail.lead.expected_value).toLocaleString()}` : "—"}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-1">
                  <Calendar className="h-3 w-3 mt-0.5 text-muted-foreground" />
                  <div>
                    <span className="text-muted-foreground">Created</span>
                    <p className="font-medium text-foreground">{formatDate(detail.lead.created_at)}</p>
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Stage</span>
                  <Badge variant="secondary" className="text-[10px] mt-0.5">{detail.lead.stage}</Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Priority</span>
                  <p className="font-medium text-foreground">{detail.lead.priority || "—"}</p>
                </div>
              </div>
            </div>

            <Separator />

            {/* Chatter / Messages */}
            <div className="space-y-3 my-4">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5" />
                Chatter
                <Badge variant="secondary" className="text-[10px]">{detail.messages.length}</Badge>
                {detail.messages_table === "none" && (
                  <span className="text-[10px] text-muted-foreground">(table not found)</span>
                )}
              </h3>
              {detail.messages.length === 0 ? (
                <p className="text-xs text-muted-foreground">No chatter messages found.</p>
              ) : (
                <div className="space-y-2">
                  {detail.messages.map((msg, i: number) => (
                    <div key={i} className="rounded-md border border-border p-2 text-xs">
                      <div className="flex justify-between text-muted-foreground mb-1">
                        <span>{msg.author || msg.user_name || "System"}</span>
                        <span>{formatDate(msg.created_at)}</span>
                      </div>
                      <p className="text-foreground">{msg.body || msg.content || msg.message || "—"}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            {/* Attachments */}
            <div className="space-y-3 my-4">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <Paperclip className="h-3.5 w-3.5" />
                Attachments
                <Badge variant="secondary" className="text-[10px]">{detail.attachments.length}</Badge>
              </h3>
              {detail.attachments.length === 0 ? (
                <p className="text-xs text-muted-foreground">No attachments found.</p>
              ) : (
                <div className="space-y-1.5">
                  {detail.attachments.map((att, i: number) => (
                    <div key={i} className="flex items-center justify-between rounded border border-border p-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate text-foreground">{att.name}</span>
                        <span className="text-muted-foreground shrink-0">
                          {att.size ? `${(att.size / 1024).toFixed(0)} KB` : ""}
                        </span>
                      </div>
                      {att.url && (
                        <a href={att.url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-3.5 w-3.5 text-primary hover:text-primary/80" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            {/* Actions */}
            <div className="space-y-2 my-4">
              <h3 className="text-sm font-semibold text-foreground">Actions</h3>
              <div className="flex flex-col gap-2">
                {onStartEstimationWithFiles && detail.attachments.length > 0 && (
                  <Button onClick={useAsContext} size="sm" className="gap-1.5 text-xs w-full">
                    <Zap className="h-3.5 w-3.5" />
                    Use as Estimation Context
                  </Button>
                )}
                <Button onClick={learnFromLead} disabled={learning} variant="outline" size="sm" className="gap-1.5 text-xs w-full">
                  {learning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookOpen className="h-3.5 w-3.5" />}
                  Learn from This Lead
                </Button>
              </div>
            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default LeadDetailPanel;
