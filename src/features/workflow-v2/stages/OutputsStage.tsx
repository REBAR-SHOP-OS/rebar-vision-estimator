import OutputsTab from "@/components/workspace/OutputsTab";
import { GateBanner, CalibrationGate, type StageProps } from "./_shared";

export default function OutputsStage({ projectId, state, goToStage }: StageProps) {
  if (!state.local.calibrationConfirmed) {
    return <CalibrationGate state={state} goToStage={goToStage} stageLabel="Outputs" />;
  }
  if (!state.estimatorConfirmed) {
    return (
      <div className="p-4">
        <GateBanner
          tone="blocked"
          title="Export Blocked: Estimator Confirmation Required"
          message="Complete Stage 06 to unlock live outputs and exports."
        />
      </div>
    );
  }

  return <OutputsTab projectId={projectId} />;
}
