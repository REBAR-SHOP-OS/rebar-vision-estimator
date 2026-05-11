import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import OutcomeCapture from "@/components/audit/OutcomeCapture";
import DrawingSearchPanel from "@/components/search/DrawingSearchPanel";
import ProjectHealthDashboard from "@/components/dashboard/ProjectHealthDashboard";
import AdminDiagnosticsPanel from "@/components/dashboard/AdminDiagnosticsPanel";
import RebarForgeDashboard, { type DashboardProject } from "@/components/dashboard/RebarForgeDashboard";
import { toast } from "sonner";
import { computeSHA256 } from "@/lib/file-hash";
import {
  createProjectFileWithCanonicalBridge,
  createProjectWithCanonicalBridge,
  inferRebarFileKind,
} from "@/lib/rebar-intake";

const Dashboard: React.FC = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<DashboardProject[]>([]);
  const [creatingProject, setCreatingProject] = useState(false);
  const [showOutcomes, setShowOutcomes] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showHealth, setShowHealth] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const newProjectFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) {
      if (error.message?.includes("JWT expired") || error.message?.includes("Invalid Refresh Token")) {
        toast.error("Session expired. Please sign in again.");
        signOut();
        return;
      }
      toast.error("Failed to load projects");
      return;
    }

    setProjects(data || []);
  };

  const handleDeleteProject = async (id: string) => {
    const target = projects.find((p) => p.id === id);
    const confirmed = window.confirm(
      `Delete project "${target?.name ?? "this project"}"? This cannot be undone.`,
    );
    if (!confirmed) return;
    const { error } = await supabase.from("projects").delete().eq("id", id);
    if (error) {
      if (error.message?.includes("JWT expired") || error.message?.includes("Invalid Refresh Token")) {
        toast.error("Session expired. Please sign in again.");
        signOut();
        return;
      }
      toast.error("Failed to delete project");
      return;
    }
    setProjects((prev) => prev.filter((p) => p.id !== id));
    toast.success("Project deleted");
  };

  const handleNewEstimationClick = () => {
    newProjectFileInputRef.current?.click();
  };

  const handleNewProjectFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0 || !user) return;
    const files = Array.from(fileList);
    setCreatingProject(true);
    const projectName = files[0].name.replace(/\.[^/.]+$/, "");

    try {
      const { data: dupCheck } = await supabase.functions.invoke("check-duplicate", {
        body: { project_name: projectName },
      });
      if (dupCheck?.is_duplicate && dupCheck.matches?.length > 0) {
        const match = dupCheck.matches[0];
        const proceed = window.confirm(
          `A similar project exists: "${match.name}" (${Math.round(match.similarity * 100)}% match). Create anyway?`,
        );
        if (!proceed) {
          setCreatingProject(false);
          if (newProjectFileInputRef.current) newProjectFileInputRef.current.value = "";
          return;
        }
      }
    } catch (err) {
      console.warn("Duplicate check failed, proceeding:", err);
    }

    const normalizedName = projectName.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();

    let project: DashboardProject | null = null;

    try {
      project = await createProjectWithCanonicalBridge(supabase, {
        userId: user.id,
        projectName,
        normalizedName,
      });
    } catch (error: unknown) {
      if (error instanceof Error && (error.message?.includes("JWT expired") || error.message?.includes("Invalid Refresh Token"))) {
        toast.error("Session expired. Please sign in again.");
        signOut();
        return;
      }
      console.error("Failed to create canonical project:", error);
      toast.error("Project creation failed before canonical rebar sync completed.");
      setCreatingProject(false);
      return;
    }

    const projectBridgeHealthy = (project as DashboardProject & {
      canonicalBridgeHealthy?: boolean;
      canonicalBridgeError?: string;
    }).canonicalBridgeHealthy !== false;

    if (!projectBridgeHealthy) {
      const projectBridgeError = (project as DashboardProject & { canonicalBridgeError?: string }).canonicalBridgeError;
      toast.warning(
        projectBridgeError
          ? `Project created with legacy fallback. Canonical sync will retry later: ${projectBridgeError}`
          : "Project created with legacy fallback. Canonical sync will retry later.",
      );
    }

    let uploadedCount = 0;
    let legacyFallbackFileCount = 0;

    for (const file of files) {
      const path = `${user.id}/${project.id}/${Date.now()}_${file.name}`;
      const { error: storageErr } = await supabase.storage.from("blueprints").upload(path, file);
      if (storageErr) {
        console.error("Storage upload error:", file.name, storageErr);
        toast.error(`Upload failed: ${file.name} — ${storageErr.message}`);
        continue;
      }

      let checksumSha256: string | null = null;
      try {
        checksumSha256 = await computeSHA256(file);
      } catch (hashErr) {
        console.warn(`Checksum generation failed for ${file.name}:`, hashErr);
      }

      try {
        const fileRow = await createProjectFileWithCanonicalBridge(supabase, {
          projectId: project.id,
          userId: user.id,
          fileName: file.name,
          filePath: path,
          fileType: file.type || null,
          fileSize: file.size,
          fileKind: inferRebarFileKind(file.name, file.type || null),
          checksumSha256,
        });
        uploadedCount++;

        const fileBridgeHealthy = (fileRow as { canonicalBridgeHealthy?: boolean }).canonicalBridgeHealthy !== false;
        if (!fileBridgeHealthy) legacyFallbackFileCount++;
      } catch (fileErr) {
        console.warn(`Failed to complete canonical intake for ${file.name}:`, fileErr);
        toast.error(`Canonical file intake failed: ${file.name}`);
      }
    }

    if (uploadedCount > 0) {
      toast.success(`${uploadedCount} file${uploadedCount > 1 ? "s" : ""} uploaded`);
      if (legacyFallbackFileCount > 0) {
        toast.warning(
          `${legacyFallbackFileCount} file${legacyFallbackFileCount > 1 ? "s were" : " was"} saved through the legacy fallback path while canonical sync is unavailable.`,
        );
      }
      supabase.functions.invoke("process-pipeline", { body: { project_id: project.id } }).catch(console.warn);
    } else {
      toast.error("No files were uploaded successfully");
    }

    setCreatingProject(false);
    if (newProjectFileInputRef.current) newProjectFileInputRef.current.value = "";
    navigate(`/app/project/${project.id}`);
  };

  if (showHealth) return <ProjectHealthDashboard onClose={() => setShowHealth(false)} />;
  if (showDiagnostics) return <AdminDiagnosticsPanel onClose={() => setShowDiagnostics(false)} />;
  if (showSearch) {
    return (
      <DrawingSearchPanel
        onClose={() => setShowSearch(false)}
        onSelectProject={(projectId) => {
          setShowSearch(false);
          navigate(`/app/project/${projectId}`);
        }}
      />
    );
  }
  if (showOutcomes) {
    return <OutcomeCapture projects={projects.map((project) => ({ id: project.id, name: project.name }))} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <input
        ref={newProjectFileInputRef}
        type="file"
        multiple
        accept="*"
        onChange={handleNewProjectFileSelect}
        className="hidden"
      />
      <RebarForgeDashboard
        projects={projects}
        creatingProject={creatingProject}
        onSelectProject={(id) => navigate(`/app/project/${id}`)}
        onNewEstimation={handleNewEstimationClick}
        onShowSearch={() => setShowSearch(true)}
        onShowHealth={() => setShowHealth(true)}
        onShowDiagnostics={() => setShowDiagnostics(true)}
        onShowOutcomes={() => setShowOutcomes(true)}
        onDeleteProject={handleDeleteProject}
      />
    </div>
  );
};

export default Dashboard;
