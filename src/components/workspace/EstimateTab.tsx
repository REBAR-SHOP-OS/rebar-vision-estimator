import OutputsTab from "./OutputsTab";

export default function EstimateTab({ projectId }: { projectId: string }) {
  return <OutputsTab projectId={projectId} filter="estimate" />;
}