import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileSearch, Activity, AlertCircle, Clock, Database } from "lucide-react";

const STORAGE_INVENTORY: { bucket: string; access: string; purpose: string }[] = [
  { bucket: "blueprints", access: "Private (RLS policies on storage.objects)", purpose: "Estimator uploads: PDFs, spreadsheets, rendered OCR page images, optional training/knowledge paths under user prefixes." },
  { bucket: "lead-files", access: "Public object URLs (CRM edge functions)", purpose: "Sales/pipeline attachments — not part of the verified estimate pipeline." },
];

const DATA_STORES_NOTE =
  "This app uses Supabase Postgres as source of truth. If production used a bucket named estimation-files, compare with blueprints above and plan migration; this repo standardizes on blueprints for drawing uploads.";

const CANONICAL_TABLE_GROUPS: { title: string; items: string[] }[] = [
  {
    title: "Verified pipeline (exports)",
    items: [
      "verified_estimate_results — current canonical JSON + content_hash; Excel/shop exports read this when available",
      "estimate_line_evidence — optional row-level provenance links",
      "export_jobs — audit of exports tied to a verified snapshot",
      "reference_answer_lines + estimation_validation_rules — benchmarks and export thresholds",
    ],
  },
  {
    title: "Ingestion & extraction",
    items: [
      "project_files + document_versions (pdf_metadata pages)",
      "document_registry — file classification & parse/extraction status",
      "document_sheets + sheet_regions — per-page index",
      "extracted_entities — normalized entities (populated from indexing)",
      "drawing_search_index + logical_drawings — search & reconciliation",
    ],
  },
  {
    title: "Workspace estimate (segments UI)",
    items: ["segments", "estimate_items", "bar_items", "segment_source_links", "validation_issues"],
  },
];

const AdminDiagnosticsPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { user } = useAuth();
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [reconciliations, setReconciliations] = useState<any[]>([]);
  const [processingJobs, setProcessingJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("reconciliation_records").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("processing_jobs").select("*").order("created_at", { ascending: false }).limit(50),
    ]).then(([auditRes, reconRes, jobsRes]) => {
      setAuditLogs(auditRes.data || []);
      setReconciliations(reconRes.data || []);
      setProcessingJobs(jobsRes.data || []);
      setLoading(false);
    });
  }, [user]);

  const statusColor = (status: string) => {
    switch (status) {
      case "completed": return "bg-primary/15 text-primary";
      case "processing": return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
      case "failed": return "bg-destructive/15 text-destructive";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const fmtTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          Diagnostics
        </h2>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : (
        <Tabs defaultValue="jobs" className="space-y-3">
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
            <TabsTrigger value="jobs" className="text-xs">Jobs ({processingJobs.length})</TabsTrigger>
            <TabsTrigger value="audit" className="text-xs">Audit ({auditLogs.length})</TabsTrigger>
            <TabsTrigger value="recon" className="text-xs">Recon ({reconciliations.length})</TabsTrigger>
            <TabsTrigger value="stores" className="text-xs">Data stores</TabsTrigger>
          </TabsList>

          <TabsContent value="jobs">
            <Card className="border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="h-4 w-4" /> Processing Jobs
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px]">
                  <div className="space-y-2">
                    {processingJobs.map((job) => (
                      <div key={job.id} className="rounded-lg border border-border p-3 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <Badge className={`text-[9px] ${statusColor(job.status)}`}>{job.status}</Badge>
                          <span className="text-xs text-muted-foreground">{job.job_type}</span>
                          <span className="text-[10px] text-muted-foreground ml-auto">{fmtTime(job.created_at)}</span>
                        </div>
                        {job.progress > 0 && job.progress < 100 && (
                          <div className="w-full bg-muted rounded-full h-1.5">
                            <div className="bg-primary h-1.5 rounded-full" style={{ width: `${job.progress}%` }} />
                          </div>
                        )}
                        {job.error_message && (
                          <p className="text-[10px] text-destructive">{job.error_message}</p>
                        )}
                        {job.result && Object.keys(job.result).length > 0 && (
                          <p className="text-[10px] text-muted-foreground font-mono truncate">
                            {JSON.stringify(job.result).slice(0, 120)}
                          </p>
                        )}
                      </div>
                    ))}
                    {processingJobs.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-8">No processing jobs yet</p>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="audit">
            <Card className="border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileSearch className="h-4 w-4" /> Audit Log
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px]">
                  <div className="space-y-1">
                    {auditLogs.map((log) => (
                      <div key={log.id} className="flex items-start gap-2 py-1.5 border-b border-border/50">
                        <Badge variant="outline" className="text-[9px] flex-shrink-0">{log.action}</Badge>
                        <span className="text-[10px] text-muted-foreground truncate flex-1 font-mono">
                          {JSON.stringify(log.details || {}).slice(0, 80)}
                        </span>
                        <span className="text-[10px] text-muted-foreground flex-shrink-0">{fmtTime(log.created_at)}</span>
                      </div>
                    ))}
                    {auditLogs.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-8">No audit entries</p>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="recon">
            <Card className="border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" /> Reconciliation Records
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px]">
                  <div className="space-y-2">
                    {reconciliations.map((rec) => (
                      <div key={rec.id} className="rounded-lg border border-border p-3 space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant={rec.resolved ? "default" : "destructive"} className="text-[9px]">
                            {rec.resolved ? "Resolved" : rec.issue_type}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground ml-auto">{fmtTime(rec.created_at)}</span>
                        </div>
                        {rec.notes && <p className="text-[10px] text-foreground">{rec.notes}</p>}
                      </div>
                    ))}
                    {reconciliations.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-8">No reconciliation records</p>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="stores">
            <Card className="border-border mb-3">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Database className="h-4 w-4" /> Data stores audit
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-xs text-muted-foreground">
                <p>{DATA_STORES_NOTE}</p>
                <div>
                  <p className="font-semibold text-foreground mb-1">Storage buckets (code references)</p>
                  <ul className="space-y-2">
                    {STORAGE_INVENTORY.map((s) => (
                      <li key={s.bucket} className="rounded border border-border/60 p-2">
                        <span className="font-mono text-foreground">{s.bucket}</span>
                        <span className="block text-[10px] mt-0.5">{s.access}</span>
                        <span className="block mt-1">{s.purpose}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="font-semibold text-foreground mb-1">Primary Postgres tables</p>
                  {CANONICAL_TABLE_GROUPS.map((g) => (
                    <div key={g.title} className="mb-2">
                      <p className="text-[11px] font-medium text-foreground">{g.title}</p>
                      <ul className="list-disc pl-4 mt-1 space-y-0.5">
                        {g.items.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
};

export default AdminDiagnosticsPanel;
