import React from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Activity,
  AlertTriangle,
  ChevronRight,
  ClipboardCheck,
  Download,
  FolderKanban,
  MapPin,
  Plus,
  Radar,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface DashboardProject {
  id: string;
  name: string;
  status: string;
  created_at: string;
  updated_at?: string;
  workflow_status?: string;
  linkage_score?: string;
  intake_complete?: boolean;
  client_name?: string | null;
  address?: string | null;
}

interface RebarForgeDashboardProps {
  projects: DashboardProject[];
  creatingProject: boolean;
  onSelectProject: (id: string) => void;
  onNewEstimation: () => void;
  onShowSearch: () => void;
  onShowHealth: () => void;
  onShowDiagnostics: () => void;
  onShowOutcomes: () => void;
}

function formatTimestamp(value?: string) {
  if (!value) return "Just updated";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently updated";
  return formatDistanceToNow(date, { addSuffix: true });
}

function getProjectStatus(p: DashboardProject): { label: string; tone: "active" | "review" | "intake" } {
  if (!p.intake_complete) return { label: "In Intake", tone: "intake" };
  const wf = (p.workflow_status || "").toLowerCase();
  if (wf.includes("qa") || wf.includes("review")) return { label: "Reviewing", tone: "review" };
  return { label: "In Progress", tone: "active" };
}

function StatusDot({ tone }: { tone: "ok" | "warn" | "err" }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        tone === "ok" && "bg-emerald-500",
        tone === "warn" && "bg-amber-500",
        tone === "err" && "bg-rose-500",
      )}
    />
  );
}

export default function RebarForgeDashboard({
  projects,
  creatingProject,
  onSelectProject,
  onNewEstimation,
  onShowSearch,
  onShowHealth,
  onShowDiagnostics,
  onShowOutcomes,
}: RebarForgeDashboardProps) {
  const activeProjects = projects.length;
  const intakeReady = projects.filter((p) => p.intake_complete).length;
  const reviewCount = projects.filter((p) => {
    const wf = (p.workflow_status || "").toLowerCase();
    return wf.includes("review") || wf.includes("qa") || !p.intake_complete;
  }).length;
  const healthScore = activeProjects === 0 ? 100 : Math.round((intakeReady / activeProjects) * 100);

  const recent = projects.slice(0, 4);
  const logRows = projects.slice(0, 4).map((p) => {
    const s = getProjectStatus(p);
    const tone: "ok" | "warn" | "err" = s.tone === "active" ? "ok" : s.tone === "review" ? "warn" : "err";
    return { id: p.id, name: p.name, sub: p.client_name || formatTimestamp(p.updated_at || p.created_at), tone, label: s.label };
  });

  return (
    <div className="industrial-theme min-h-0 flex-1 overflow-y-auto bg-industrial-surface text-industrial-on-surface font-['Inter',system-ui,sans-serif]">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 p-6">
        {/* Top bar with quick actions */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-industrial-outline-variant pb-4">
          <div className="flex items-center gap-3">
            <h1 className="font-hanken text-[28px] font-bold leading-none text-industrial-primary">SteelEstimator AI</h1>
            <span className="font-mono-jet text-[10px] font-semibold uppercase tracking-[0.18em] text-industrial-on-variant">
              v2 · Industrial
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-[280px] max-w-full">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-industrial-on-variant" />
              <input
                onClick={onShowSearch}
                readOnly
                placeholder="Search projects or blueprints..."
                className="w-full cursor-pointer rounded border border-industrial-outline-variant bg-industrial-surface-low py-1.5 pl-9 pr-3 text-sm text-industrial-on-surface placeholder:text-industrial-on-variant focus:outline-none focus:ring-1 focus:ring-industrial-primary"
              />
            </div>
            <Button
              onClick={onNewEstimation}
              disabled={creatingProject}
              className="h-9 rounded bg-industrial-primary px-4 font-bold text-industrial-on-primary hover:bg-industrial-primary-container disabled:opacity-60"
            >
              {creatingProject ? <Activity className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Quick Upload
            </Button>
          </div>
        </header>

        {/* Metric strip */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <MetricCard
            label="Active Projects"
            value={String(activeProjects)}
            note={`${intakeReady} intake ready`}
            icon={<FolderKanban className="h-5 w-5 text-industrial-primary" />}
          />
          <MetricCard
            label="Review Queue"
            value={String(reviewCount)}
            note="Low-confidence sheets & deltas"
            icon={<AlertTriangle className="h-5 w-5 text-industrial-primary" />}
          />
          <MetricCard
            label="Intake Health"
            value={`${healthScore}`}
            unit="%"
            note="Coverage of ready-to-work projects"
            icon={<ShieldCheck className="h-5 w-5 text-industrial-primary" />}
            progress={healthScore}
          />
        </section>

        {/* Main grid: projects + active logs */}
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-4 lg:col-span-2">
            <div className="flex items-center justify-between">
              <h3 className="font-hanken text-2xl font-bold text-industrial-on-surface">Recent Projects</h3>
              <button
                onClick={onShowSearch}
                className="flex items-center gap-1 text-sm font-bold text-industrial-primary hover:underline"
              >
                View All <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            {recent.length === 0 ? (
              <EmptyState onNewEstimation={onNewEstimation} />
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {recent.map((p) => (
                  <ProjectCard key={p.id} project={p} onClick={() => onSelectProject(p.id)} />
                ))}
              </div>
            )}
          </div>

          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="font-hanken text-2xl font-bold text-industrial-on-surface">Active Logs</h3>
              {reviewCount > 0 && (
                <span className="rounded bg-industrial-error-container px-2 py-0.5 text-[10px] font-bold uppercase text-industrial-error">
                  {reviewCount} require review
                </span>
              )}
            </div>
            <div className="flex h-full flex-col overflow-hidden border border-industrial-outline-variant bg-industrial-surface">
              <table className="w-full border-collapse text-left">
                <thead className="border-b border-industrial-outline-variant bg-industrial-surface-low">
                  <tr>
                    <th className="p-3 font-mono-jet text-[12px] font-medium uppercase tracking-wide text-industrial-on-variant">
                      Project
                    </th>
                    <th className="p-3 font-mono-jet text-[12px] font-medium uppercase tracking-wide text-industrial-on-variant">
                      State
                    </th>
                    <th className="p-3 text-center font-mono-jet text-[12px] font-medium uppercase tracking-wide text-industrial-on-variant">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-industrial-outline-variant">
                  {logRows.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="p-6 text-center text-sm text-industrial-on-variant">
                        No active logs yet.
                      </td>
                    </tr>
                  ) : (
                    logRows.map((row) => (
                      <tr
                        key={row.id}
                        onClick={() => onSelectProject(row.id)}
                        className="cursor-pointer transition-colors hover:bg-industrial-surface-low"
                      >
                        <td className="p-3">
                          <div className="flex flex-col">
                            <span className="font-bold text-industrial-on-surface">{row.name}</span>
                            <span className="text-[11px] uppercase text-industrial-on-variant">{row.sub}</span>
                          </div>
                        </td>
                        <td className="p-3 text-right font-mono-jet text-sm">{row.label}</td>
                        <td className="p-3">
                          <div className="flex justify-center">
                            <StatusDot tone={row.tone} />
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <div className="mt-auto flex justify-center border-t border-industrial-outline-variant bg-industrial-surface-low p-3">
                <button
                  onClick={onShowHealth}
                  className="font-mono-jet text-[12px] font-medium text-industrial-primary hover:underline"
                >
                  Open Project Health Board
                </button>
              </div>
            </div>
          </section>
        </section>

        {/* Bento bottom row */}
        <section className="grid grid-cols-1 gap-6 md:grid-cols-4">
          <div
            className="relative overflow-hidden border border-industrial-outline-variant bg-white p-6 md:col-span-3"
            style={{
              backgroundImage:
                "linear-gradient(to right, hsl(var(--industrial-outline-variant)) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--industrial-outline-variant)) 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          >
            <div className="relative z-10 flex h-full flex-col justify-between gap-6 md:flex-row md:items-end">
              <div className="max-w-md">
                <div className="mb-2 inline-flex items-center gap-2 rounded border border-industrial-outline-variant bg-industrial-surface-low px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-industrial-on-variant">
                  <Sparkles className="h-3 w-3 text-industrial-primary" />
                  Calibration-aware
                </div>
                <h3 className="font-hanken text-2xl font-semibold text-industrial-on-surface">
                  Automated Blueprint Intelligence
                </h3>
                <p className="mt-2 text-base leading-6 text-industrial-on-variant">
                  Upload any CAD or PDF set. The pipeline detects sheet scale before quantities, so every segment is tied to a
                  real-world measurement instead of a pixel guess.
                </p>
              </div>
              <Button
                onClick={onNewEstimation}
                className="rounded bg-industrial-on-surface px-8 py-3 font-mono-jet text-[12px] font-black uppercase tracking-widest text-industrial-surface hover:bg-industrial-primary"
              >
                Launch Blueprint Intake
              </Button>
            </div>
          </div>

          <div className="flex flex-col justify-between border border-industrial-outline bg-industrial-primary p-6 text-industrial-on-primary">
            <Download className="h-10 w-10 opacity-30" />
            <div>
              <h4 className="mb-2 font-hanken text-xl leading-tight">Outcomes & Exports</h4>
              <p className="mb-4 text-sm text-industrial-on-primary/80">
                Capture wins, losses, and shipped quantities. Export approved estimates straight to the supplier.
              </p>
              <Button
                onClick={onShowOutcomes}
                variant="ghost"
                className="w-full rounded bg-industrial-surface py-2 font-bold text-industrial-primary hover:bg-industrial-surface-low"
              >
                Capture Outcomes
              </Button>
            </div>
          </div>
        </section>

        {/* Operational shortcuts row */}
        <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <ShortcutButton onClick={onShowSearch} icon={<Search className="h-4 w-4" />} title="Drawing search" desc="Jump to a project, sheet, or bar mark." />
          <ShortcutButton onClick={onShowHealth} icon={<ShieldCheck className="h-4 w-4" />} title="Project health" desc="Readiness, pipeline state, and stalled jobs." />
          <ShortcutButton onClick={onShowDiagnostics} icon={<Radar className="h-4 w-4" />} title="Admin diagnostics" desc="Bridge health and operational fixes." />
        </section>
      </div>

      {/* Floating action button */}
      <button
        onClick={onNewEstimation}
        disabled={creatingProject}
        aria-label="New estimate"
        className="fixed bottom-8 right-8 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-industrial-primary text-industrial-on-primary shadow-lg transition-transform hover:scale-105 active:scale-95 disabled:opacity-60"
      >
        <Plus className="h-7 w-7" />
      </button>
    </div>
  );
}

function MetricCard({
  label,
  value,
  unit,
  note,
  icon,
  progress,
}: {
  label: string;
  value: string;
  unit?: string;
  note: string;
  icon: React.ReactNode;
  progress?: number;
}) {
  return (
    <div className="flex flex-col justify-between border border-industrial-outline-variant bg-industrial-surface p-5">
      <div className="flex items-start justify-between">
        <span className="font-mono-jet text-[13px] font-medium uppercase tracking-wide text-industrial-on-variant">
          {label}
        </span>
        {icon}
      </div>
      <div className="mt-4">
        <span className="font-hanken text-[48px] font-bold leading-none tracking-tight text-industrial-on-surface">
          {value}
        </span>
        {unit && (
          <span className="ml-1 font-mono-jet text-sm font-semibold uppercase text-industrial-on-variant">{unit}</span>
        )}
        <div className="mt-2 text-sm font-bold text-industrial-tertiary">{note}</div>
        {typeof progress === "number" && (
          <div className="mt-3 h-1.5 w-full overflow-hidden bg-industrial-surface-highest">
            <div className="h-full bg-industrial-primary" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectCard({ project, onClick }: { project: DashboardProject; onClick: () => void }) {
  const status = getProjectStatus(project);
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col overflow-hidden border border-industrial-outline-variant bg-industrial-surface text-left transition-colors hover:border-industrial-primary"
    >
      <div className="relative aspect-video overflow-hidden bg-industrial-surface-high">
        <div
          className="absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              "linear-gradient(to right, hsl(var(--industrial-outline-variant)) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--industrial-outline-variant)) 1px, transparent 1px)",
            backgroundSize: "16px 16px",
          }}
        />
        <div className="absolute right-2 top-2">
          <span className="bg-industrial-on-surface px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-industrial-surface">
            {status.label}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <h4 className="font-hanken text-[18px] font-semibold text-industrial-on-surface">{project.name}</h4>
          <span className="font-mono-jet text-sm font-semibold text-industrial-primary">
            {project.linkage_score || "L0"}
          </span>
        </div>
        <p className="flex items-center gap-1 text-sm text-industrial-on-variant">
          <MapPin className="h-4 w-4" />
          {project.address || project.client_name || "Location pending"}
        </p>
        <div className="mt-1 flex flex-wrap gap-2">
          <Tag>{(project.workflow_status || project.status || "intake").replace(/_/g, " ")}</Tag>
          <Tag>{formatTimestamp(project.updated_at || project.created_at)}</Tag>
        </div>
      </div>
    </button>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-industrial-outline-variant bg-industrial-surface-high px-2 py-0.5 text-[11px] font-medium text-industrial-on-variant">
      {children}
    </span>
  );
}

function ShortcutButton({
  onClick,
  icon,
  title,
  desc,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between border border-industrial-outline-variant bg-industrial-surface px-4 py-4 text-left transition hover:border-industrial-primary"
    >
      <div>
        <div className="text-sm font-semibold text-industrial-on-surface">{title}</div>
        <div className="mt-1 text-sm text-industrial-on-variant">{desc}</div>
      </div>
      <span className="text-industrial-on-variant">{icon}</span>
    </button>
  );
}

function EmptyState({ onNewEstimation }: { onNewEstimation: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 border border-dashed border-industrial-outline-variant bg-industrial-surface p-10 text-center">
      <ClipboardCheck className="h-8 w-8 text-industrial-on-variant" />
      <h4 className="font-hanken text-xl font-semibold text-industrial-on-surface">No projects yet</h4>
      <p className="max-w-sm text-sm text-industrial-on-variant">
        Upload a drawing set to start. Calibration runs first so quantities are tied to real-world measurements.
      </p>
      <Button
        onClick={onNewEstimation}
        className="mt-2 rounded bg-industrial-primary text-industrial-on-primary hover:bg-industrial-primary-container"
      >
        <Plus className="mr-2 h-4 w-4" />
        New estimate
      </Button>
    </div>
  );
}

