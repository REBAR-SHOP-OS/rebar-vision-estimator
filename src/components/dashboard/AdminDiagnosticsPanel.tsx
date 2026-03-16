import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileSearch, Activity, AlertCircle, Clock } from "lucide-react";

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
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="jobs" className="text-xs">Jobs ({processingJobs.length})</TabsTrigger>
            <TabsTrigger value="audit" className="text-xs">Audit ({auditLogs.length})</TabsTrigger>
            <TabsTrigger value="recon" className="text-xs">Recon ({reconciliations.length})</TabsTrigger>
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
        </Tabs>
      )}
    </div>
  );
};

export default AdminDiagnosticsPanel;
