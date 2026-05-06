import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface WorkflowState {
  fileCount: number;
  files: Array<{ id: string; file_name: string; file_path: string; created_at: string; file_size?: number | null }>;
  scopeCandidates: number;
  scopeAccepted: number;
  takeoffRows: number;
  qaOpen: number;
  qaCriticalOpen: number;
  estimatorConfirmed: boolean;
  refresh: () => void;
}

const LS_KEY = (pid: string) => `rvev2:${pid}`;

function readLocal(pid: string) {
  try { return JSON.parse(localStorage.getItem(LS_KEY(pid)) || "{}"); } catch { return {}; }
}
function writeLocal(pid: string, patch: Record<string, unknown>) {
  const cur = readLocal(pid);
  localStorage.setItem(LS_KEY(pid), JSON.stringify({ ...cur, ...patch }));
}

export function useWorkflowState(projectId: string): WorkflowState & {
  setLocal: (patch: Record<string, unknown>) => void;
  local: Record<string, unknown>;
} {
  const [files, setFiles] = useState<WorkflowState["files"]>([]);
  const [qaOpen, setQaOpen] = useState(0);
  const [qaCriticalOpen, setQaCriticalOpen] = useState(0);
  const [takeoffRows, setTakeoffRows] = useState(0);
  const [local, setLocalState] = useState<Record<string, unknown>>(() => readLocal(projectId));
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [f, vi, ei] = await Promise.all([
        supabase.from("project_files").select("id,file_name,file_path,created_at,file_size").eq("project_id", projectId).order("created_at", { ascending: false }),
        supabase.from("validation_issues").select("severity,status").eq("project_id", projectId),
        supabase.from("estimate_items").select("id", { count: "exact", head: true }).eq("project_id", projectId),
      ]);
      if (cancelled) return;
      setFiles(f.data || []);
      const open = (vi.data || []).filter((i) => (i as Record<string, unknown>).status !== "resolved" && (i as Record<string, unknown>).status !== "closed");
      setQaOpen(open.length);
      setQaCriticalOpen(open.filter((i) => (i as Record<string, unknown>).severity === "critical" || (i as Record<string, unknown>).severity === "error").length);
      setTakeoffRows(ei.count || 0);
    })();
    return () => { cancelled = true; };
  }, [projectId, tick]);

  useEffect(() => { setLocalState(readLocal(projectId)); }, [projectId, tick]);

  const setLocal = useCallback((patch: Record<string, unknown>) => {
    writeLocal(projectId, patch);
    setLocalState((s) => ({ ...s, ...patch }));
  }, [projectId]);

  const scope = (local.scope || {}) as Record<string, "accept" | "hold" | "reroute">;
  const scopeCandidates = Math.max(files.length, Object.keys(scope).length);
  const scopeAccepted = Object.values(scope).filter((v) => v === "accept").length;

  return {
    fileCount: files.length,
    files,
    scopeCandidates,
    scopeAccepted,
    takeoffRows,
    qaOpen,
    qaCriticalOpen,
    estimatorConfirmed: !!local.estimatorConfirmed,
    refresh,
    setLocal,
    local,
  };
}

export type WorkflowStateFull = ReturnType<typeof useWorkflowState>;