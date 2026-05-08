import OutputsTab from "@/components/workspace/OutputsTab";
import { GateBanner, type StageProps } from "./_shared";

export default function OutputsStage({ projectId, state }: StageProps) {
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
