import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getCanonicalProjectFiles, type CanonicalProjectFileView } from "@/lib/rebar-read-model";

export interface WorkflowState {
  fileCount: number;
  files: Array<{
    id: string;
    legacy_file_id?: string | null;
    file_name: string;
    file_path: string;
    created_at: string;
    file_size?: number | null;
  }>;
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

function mergeWorkflowFiles(
  canonicalFiles: CanonicalProjectFileView[],
  legacyFiles: Array<{ id: string; file_name: string; file_path: string; created_at: string; file_size?: number | null }>,
) {
  if (canonicalFiles.length === 0) {
    return legacyFiles.map((file) => ({
      ...file,
      legacy_file_id: file.id,
    }));
  }

  const legacyById = new Map(legacyFiles.map((file) => [file.id, file]));

  const canonicalRows = canonicalFiles.map((file) => {
    const legacyFile = file.legacyFileId ? legacyById.get(file.legacyFileId) : null;

    return {
      id: file.rebarProjectFileId,
      legacy_file_id: file.legacyFileId,
      file_name: file.originalFilename,
      file_path: file.storagePath,
      created_at: legacyFile?.created_at || file.uploadedAt,
      file_size: legacyFile?.file_size || null,
    };
  });

  const linkedLegacyIds = new Set(
    canonicalFiles
      .map((file) => file.legacyFileId)
      .filter((legacyFileId): legacyFileId is string => Boolean(legacyFileId)),
  );

  const legacyOnlyRows = legacyFiles
    .filter((file) => !linkedLegacyIds.has(file.id))
    .map((file) => ({
      ...file,
      legacy_file_id: file.id,
    }));

  return [...canonicalRows, ...legacyOnlyRows];
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
      const [canonicalFiles, f, vi, ei] = await Promise.all([
        getCanonicalProjectFiles(supabase, projectId).catch((error) => {
          console.warn("Failed to load canonical workflow files:", error);
          return [] as CanonicalProjectFileView[];
        }),
        supabase.from("project_files").select("id,file_name,file_path,created_at,file_size").eq("project_id", projectId).order("created_at", { ascending: false }),
        supabase.from("validation_issues").select("severity,status").eq("project_id", projectId),
        supabase.from("estimate_items").select("id", { count: "exact", head: true }).eq("project_id", projectId),
      ]);
      if (cancelled) return;
      setFiles(mergeWorkflowFiles(canonicalFiles, f.data || []));
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
