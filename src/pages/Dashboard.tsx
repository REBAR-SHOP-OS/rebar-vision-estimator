import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Plus, Loader2 } from "lucide-react";
import ProjectDashboard from "@/components/workspace/ProjectDashboard";
import OutcomeCapture from "@/components/audit/OutcomeCapture";
import DrawingSearchPanel from "@/components/search/DrawingSearchPanel";
import ProjectHealthDashboard from "@/components/dashboard/ProjectHealthDashboard";
import AdminDiagnosticsPanel from "@/components/dashboard/AdminDiagnosticsPanel";
import { toast } from "sonner";

interface Project {
  id: string;
  name: string;
  status: string;
  created_at: string;
  workflow_status?: string;
  linkage_score?: string;
  intake_complete?: boolean;
}

const Dashboard: React.FC = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [creatingProject, setCreatingProject] = useState(false);
  const [showCrm, setShowCrm] = useState(false);
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

  const handleNewEstimationClick = () => {
    newProjectFileInputRef.current?.click();
  };

  const handleNewProjectFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !user) return;
    setCreatingProject(true);
    const projectName = files[0].name.replace(/\.[^/.]+$/, "");

    try {
      const { data: dupCheck } = await supabase.functions.invoke("check-duplicate", {
        body: { project_name: projectName },
      });
      if (dupCheck?.is_duplicate && dupCheck.matches?.length > 0) {
        const match = dupCheck.matches[0];
        const proceed = window.confirm(
          `A similar project exists: "${match.name}" (${Math.round(match.similarity * 100)}% match). Create anyway?`
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
    const { data, error } = await supabase
      .from("projects")
      .insert({ user_id: user.id, name: projectName, normalized_name: normalizedName, workflow_status: "intake" })
      .select()
      .single();

    if (error) {
      if (error.message?.includes("JWT expired") || error.message?.includes("Invalid Refresh Token")) {
        toast.error("Session expired. Please sign in again.");
        signOut();
        return;
      }
      toast.error("Failed to create project");
      setCreatingProject(false);
      return;
    }

    setCreatingProject(false);
    if (newProjectFileInputRef.current) newProjectFileInputRef.current.value = "";
    // Navigate to the new project workspace
    navigate(`/app/project/${data.id}`);
  };

  // Overlay panels
  if (showHealth) return <ProjectHealthDashboard onClose={() => setShowHealth(false)} />;
  if (showDiagnostics) return <AdminDiagnosticsPanel onClose={() => setShowDiagnostics(false)} />;
  if (showSearch) return (
    <DrawingSearchPanel
      onClose={() => setShowSearch(false)}
      onSelectProject={(projectId) => {
        setShowSearch(false);
        navigate(`/app/project/${projectId}`);
      }}
    />
  );
  if (showOutcomes) return <OutcomeCapture projects={projects.map(p => ({ id: p.id, name: p.name }))} />;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <input
        ref={newProjectFileInputRef}
        type="file"
        multiple
        accept="*"
        onChange={handleNewProjectFileSelect}
        className="hidden"
      />
      <ProjectDashboard
        onSelectProject={(id) => navigate(`/app/project/${id}`)}
        onNewEstimation={handleNewEstimationClick}
        onShowCrm={() => setShowCrm(true)}
        onShowOutcomes={() => setShowOutcomes(true)}
        onShowHealth={() => setShowHealth(true)}
        onShowDiagnostics={() => setShowDiagnostics(true)}
        onShowSearch={() => setShowSearch(true)}
      />
    </div>
  );
};

export default Dashboard;
