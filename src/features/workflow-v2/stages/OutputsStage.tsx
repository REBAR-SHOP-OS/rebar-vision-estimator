import { Lock, FileSpreadsheet, FileText, GitCompare, Stamp, Package } from "lucide-react";
import { StageHeader, type StageProps, EmptyState } from "./_shared";

const DELIVERABLES = [
  { key: "estimate", label: "Estimate Workbook", icon: FileSpreadsheet, desc: "Priced takeoff with assumptions" },
  { key: "qa", label: "QA Summary", icon: FileText, desc: "Resolved/open issues snapshot" },
  { key: "delta", label: "Revision Delta Summary", icon: GitCompare, desc: "Drawing revision impact report" },
  { key: "signoff", label: "Estimator Signoff Record", icon: Stamp, desc: "Auditable confirmation log" },
  { key: "package", label: "Client Export Package", icon: Package, desc: "Bundle for client delivery" },
];

export default function OutputsStage({ state }: StageProps) {
  const unlocked = state.estimatorConfirmed;
  return (
    <div className="flex flex-col h-full">
      <StageHeader
        kicker="Stage 06"
        title="Outputs"
        subtitle={unlocked ? "Estimator confirmed. Deliverables ready." : "Locked until Estimator Confirmation is complete."}
      />
      {!unlocked ? (
        <EmptyState
          title="Outputs locked"
          hint="Complete Estimator Confirmation (Stage 05) to unlock all deliverables. No exports are produced before signoff."
        />
      ) : (
        <div className="flex-1 overflow-auto p-4 grid grid-cols-2 gap-3">
          {DELIVERABLES.map((d) => (
            <button key={d.key} className="flex items-start gap-3 p-4 border border-border bg-card hover:bg-muted/40 text-left">
              <d.icon className="w-5 h-5 text-primary mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-semibold">{d.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{d.desc}</div>
                <div className="text-[10px] uppercase tracking-widest text-primary font-mono mt-2">Generate →</div>
              </div>
            </button>
          ))}
        </div>
      )}
      {!unlocked && (
        <div className="px-4 py-3 border-t border-border bg-muted/40 text-xs text-muted-foreground font-mono flex items-center gap-2">
          <Lock className="w-3 h-3" /> Final exports are gated by Estimator Confirmation.
        </div>
      )}
    </div>
  );
}