import React from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarClock,
  ClipboardCheck,
  FolderKanban,
  FolderSearch2,
  Plus,
  Radar,
  Scale,
  Search,
  ShieldCheck,
  Sigma,
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

const reviewQueue = [
  {
    title: "Unscaled footing details",
    body: "Sheet groups with OCR-ready content are waiting on scale calibration before quantity roll-up.",
    state: "Needs setup",
    tone: "warn",
  },
  {
    title: "Revision delta on mat reinforcement",
    body: "Added top steel and spacing changes should be reviewed before they flow into the next bid issue.",
    state: "Cost impact",
    tone: "signal",
  },
  {
    title: "Unlinked bar marks",
    body: "Detected callouts still need schedule linkage so fabrication exports stay reviewable instead of magical.",
    state: "Resolve",
    tone: "danger",
  },
];

const issueSignals = [
  {
    title: "Low-confidence OCR clusters",
    detail: "Congested wall details and cropped note leaders still need estimator judgment.",
    badge: "OCR",
  },
  {
    title: "Revision comparison ready",
    detail: "Recent packages have enough sheet coverage to generate a clean before-vs-after delta report.",
    badge: "Delta",
  },
  {
    title: "Fabrication hold points",
    detail: "A few unresolved shape or spacing assumptions should stay held from final export until approved.",
    badge: "QA",
  },
];

function formatTimestamp(value?: string) {
  if (!value) return "Just updated";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently updated";
  return `${formatDistanceToNow(date, { addSuffix: true })}`;
}

function getProjectTone(project: DashboardProject) {
  if (!project.intake_complete) return { label: "Uploading", tone: "signal" };
  const workflow = (project.workflow_status || "").toLowerCase();
  if (workflow.includes("qa") || workflow.includes("review")) return { label: "Reviewing", tone: "warn" };
  if (workflow.includes("scope") || workflow.includes("takeoff")) return { label: "In progress", tone: "success" };
  return { label: project.status || "Active", tone: "success" };
}

function getWorkflowLabel(project: DashboardProject) {
  return project.workflow_status
    ? project.workflow_status.replace(/_/g, " ")
    : project.status || "Awaiting intake";
}

function getConfidenceLabel(project: DashboardProject) {
  return project.linkage_score || (project.intake_complete ? "Model ready" : "Pending intake");
}

function getProgress(project: DashboardProject) {
  const workflow = (project.workflow_status || "").toLowerCase();
  if (!project.intake_complete) return 24;
  if (workflow.includes("scope")) return 42;
  if (workflow.includes("takeoff")) return 68;
  if (workflow.includes("qa") || workflow.includes("review")) return 86;
  return 58;
}

function StatusPill({ label, tone }: { label: string; tone: "success" | "warn" | "signal" | "danger" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]",
        tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        tone === "warn" && "border-amber-200 bg-amber-50 text-amber-700",
        tone === "signal" && "border-orange-200 bg-orange-50 text-orange-700",
        tone === "danger" && "border-rose-200 bg-rose-50 text-rose-700",
      )}
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          tone === "success" && "bg-emerald-500",
          tone === "warn" && "bg-amber-500",
          tone === "signal" && "bg-orange-500",
          tone === "danger" && "bg-rose-500",
        )}
      />
      {label}
    </span>
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
  const intakeReadyCount = projects.filter((project) => project.intake_complete).length;
  const reviewCount = projects.filter((project) => {
    const workflow = (project.workflow_status || "").toLowerCase();
    return workflow.includes("review") || workflow.includes("qa") || !project.intake_complete;
  }).length;
  const healthScore = activeProjects === 0 ? 0 : Math.round((intakeReadyCount / activeProjects) * 100);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[linear-gradient(180deg,#f7f3ec_0%,#f2eee7_100%)] text-slate-900">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-5 md:px-6 lg:px-8">
        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-[radial-gradient(circle_at_top_right,rgba(25,167,160,0.12),transparent_30%),linear-gradient(180deg,#fffdf9_0%,#f5efe5_100%)] shadow-[0_20px_50px_rgba(15,23,42,0.08)]">
          <div className="grid gap-8 p-6 lg:grid-cols-[1.25fr_0.95fr] lg:p-8">
            <div className="flex flex-col gap-6">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                <Sparkles className="h-3.5 w-3.5 text-teal-600" />
                Estimator command center
              </div>
              <div className="max-w-3xl">
                <h2 className="font-['Bahnschrift','Segoe_UI',sans-serif] text-4xl font-bold leading-[1.02] tracking-tight text-slate-950 md:text-5xl">
                  Drawing-first takeoff, schedule-first review, bid-ready output.
                </h2>
                <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 md:text-lg">
                  Keep the shell quiet and the workflow explicit: upload, classify, detect, review, quantify, and publish.
                  The AI stays practical, reviewable, and tied back to real sheets instead of floating as a generic chatbot.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button onClick={onNewEstimation} className="h-11 rounded-xl bg-teal-600 px-5 text-sm font-semibold text-white hover:bg-teal-700">
                  {creatingProject ? <Activity className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  New drawing intake
                </Button>
                <Button variant="outline" onClick={onShowSearch} className="h-11 rounded-xl border-slate-300 bg-white/80 px-5 text-sm text-slate-700 hover:bg-white">
                  <Search className="mr-2 h-4 w-4" />
                  Search drawings
                </Button>
                <Button variant="ghost" onClick={onShowHealth} className="h-11 rounded-xl px-4 text-sm text-slate-600 hover:bg-white/70">
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  Health board
                </Button>
                <Button variant="ghost" onClick={onShowDiagnostics} className="h-11 rounded-xl px-4 text-sm text-slate-600 hover:bg-white/70">
                  <Radar className="mr-2 h-4 w-4" />
                  Diagnostics
                </Button>
                <Button variant="ghost" onClick={onShowOutcomes} className="h-11 rounded-xl px-4 text-sm text-slate-600 hover:bg-white/70">
                  <ClipboardCheck className="mr-2 h-4 w-4" />
                  Outcomes
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="border-t border-slate-200 pt-4">
                  <div className="font-['Bahnschrift','Segoe_UI',sans-serif] text-2xl font-bold text-slate-950">{activeProjects}</div>
                  <div className="mt-1 text-sm text-slate-500">Active bid packages in the current estimating queue</div>
                </div>
                <div className="border-t border-slate-200 pt-4">
                  <div className="font-['Bahnschrift','Segoe_UI',sans-serif] text-2xl font-bold text-slate-950">{intakeReadyCount}</div>
                  <div className="mt-1 text-sm text-slate-500">Projects with intake complete and ready for scope review</div>
                </div>
                <div className="border-t border-slate-200 pt-4">
                  <div className="font-['Bahnschrift','Segoe_UI',sans-serif] text-2xl font-bold text-slate-950">{healthScore}%</div>
                  <div className="mt-1 text-sm text-slate-500">Current intake health based on ready-to-work project coverage</div>
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-white/80 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.06)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Estimator queue</div>
                  <h3 className="mt-2 font-['Bahnschrift','Segoe_UI',sans-serif] text-2xl font-bold text-slate-950">
                    What needs attention now
                  </h3>
                </div>
                <StatusPill label={`${Math.max(reviewCount, 3)} review items`} tone="warn" />
              </div>
              <div className="mt-5 space-y-3">
                {reviewQueue.map((item) => (
                  <article key={item.title} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900">{item.title}</h4>
                        <p className="mt-2 text-sm leading-6 text-slate-600">{item.body}</p>
                      </div>
                      <StatusPill label={item.state} tone={item.tone as "success" | "warn" | "signal" | "danger"} />
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-4">
          {[
            {
              label: "Active projects",
              value: `${activeProjects}`,
              note: "Across takeoff, QA, and revision compare",
              icon: FolderKanban,
            },
            {
              label: "Review queue",
              value: `${reviewCount}`,
              note: "Low-confidence notes, unscaled sheets, and deltas",
              icon: AlertTriangle,
            },
            {
              label: "Project health",
              value: `${healthScore}%`,
              note: "Estimated readiness based on current intake completion",
              icon: ShieldCheck,
            },
            {
              label: "Output coverage",
              value: `${projects.filter((project) => project.workflow_status).length}`,
              note: "Projects far enough along to produce structured outputs",
              icon: Sigma,
            },
          ].map((metric) => (
            <article key={metric.label} className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{metric.label}</div>
                  <div className="mt-4 font-['Bahnschrift','Segoe_UI',sans-serif] text-4xl font-bold leading-none text-slate-950">
                    {metric.value}
                  </div>
                </div>
                <div className="rounded-2xl bg-slate-950 p-3 text-white">
                  <metric.icon className="h-5 w-5" />
                </div>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-600">{metric.note}</p>
            </article>
          ))}
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.95fr)]">
          <div className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Projects</div>
                <h3 className="mt-2 font-['Bahnschrift','Segoe_UI',sans-serif] text-3xl font-bold text-slate-950">
                  Bid dashboard
                </h3>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                  A cleaner estimate queue with drawing intake status, review posture, and how recently each project actually moved.
                </p>
              </div>
              <Button variant="outline" onClick={onShowSearch} className="h-11 rounded-xl border-slate-300 px-4 text-sm text-slate-700 hover:bg-slate-50">
                Open drawing search
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
            <div className="mt-6 grid gap-4 xl:grid-cols-2">
              {projects.map((project) => {
                const tone = getProjectTone(project);
                const progress = getProgress(project);
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => onSelectProject(project.id)}
                    className="group rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#fcfbf8_100%)] p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-[0_20px_30px_rgba(15,23,42,0.08)]"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{getWorkflowLabel(project)}</div>
                        <h4 className="mt-2 font-['Bahnschrift','Segoe_UI',sans-serif] text-2xl font-bold leading-tight text-slate-950">
                          {project.name}
                        </h4>
                        <p className="mt-2 text-sm text-slate-500">{project.intake_complete ? "Location pending in current data model" : "Awaiting first upload completion"}</p>
                      </div>
                      <StatusPill label={tone.label} tone={tone.tone as "success" | "warn" | "signal" | "danger"} />
                    </div>
                    <div className="mt-5 grid grid-cols-2 gap-3 text-sm text-slate-600">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500"><CalendarClock className="h-3.5 w-3.5" /> Bid date</div>
                        <div className="mt-2 font-medium text-slate-900">Not set</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500"><Scale className="h-3.5 w-3.5" /> Confidence</div>
                        <div className="mt-2 font-medium text-slate-900">{getConfidenceLabel(project)}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500"><Building2 className="h-3.5 w-3.5" /> Steel quantity</div>
                        <div className="mt-2 font-medium text-slate-900">Pending roll-up</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500"><FolderSearch2 className="h-3.5 w-3.5" /> Updated</div>
                        <div className="mt-2 font-medium text-slate-900">{formatTimestamp(project.updated_at || project.created_at)}</div>
                      </div>
                    </div>
                    <div className="mt-5">
                      <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        <span>Estimate progress</span>
                        <span>{progress}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100">
                        <div className="h-2 rounded-full bg-gradient-to-r from-teal-500 to-cyan-400" style={{ width: `${progress}%` }} />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-6">
            <section className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Operational shortcuts</div>
                  <h3 className="mt-2 font-['Bahnschrift','Segoe_UI',sans-serif] text-2xl font-bold text-slate-950">Fast actions</h3>
                </div>
                <StatusPill label="Main updated" tone="success" />
              </div>
              <div className="mt-5 space-y-3">
                <button onClick={onShowSearch} className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:border-teal-300 hover:bg-white">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Open drawing search</div>
                    <div className="mt-1 text-sm text-slate-500">Jump straight to a project, sheet, or bar mark.</div>
                  </div>
                  <Search className="h-4 w-4 text-slate-400" />
                </button>
                <button onClick={onShowHealth} className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:border-teal-300 hover:bg-white">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Project health board</div>
                    <div className="mt-1 text-sm text-slate-500">Check readiness, pipeline health, and stalled estimations.</div>
                  </div>
                  <ShieldCheck className="h-4 w-4 text-slate-400" />
                </button>
                <button onClick={onShowDiagnostics} className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:border-teal-300 hover:bg-white">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Admin diagnostics</div>
                    <div className="mt-1 text-sm text-slate-500">Inspect bridge health, sync state, and operational fixes.</div>
                  </div>
                  <Radar className="h-4 w-4 text-slate-400" />
                </button>
                <button onClick={onShowOutcomes} className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:border-teal-300 hover:bg-white">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Capture outcomes</div>
                    <div className="mt-1 text-sm text-slate-500">Track what shipped, what stalled, and what still needs review.</div>
                  </div>
                  <ClipboardCheck className="h-4 w-4 text-slate-400" />
                </button>
              </div>
            </section>

            <section className="rounded-[26px] border border-slate-200 bg-[linear-gradient(145deg,#152126_0%,#24333a_100%)] p-5 text-white shadow-sm md:p-6">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/60">Review signals</div>
              <h3 className="mt-2 font-['Bahnschrift','Segoe_UI',sans-serif] text-2xl font-bold text-white">
                Keep AI practical and reviewable.
              </h3>
              <div className="mt-5 space-y-3">
                {issueSignals.map((item) => (
                  <article key={item.title} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 backdrop-blur-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-white">{item.title}</div>
                        <div className="mt-2 text-sm leading-6 text-white/70">{item.detail}</div>
                      </div>
                      <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/80">
                        {item.badge}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </section>
      </div>
    </div>
  );
}
