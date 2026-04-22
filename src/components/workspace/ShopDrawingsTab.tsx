import OutputsTab from "./OutputsTab";

export default function ShopDrawingsTab({ projectId }: { projectId: string }) {
  return <OutputsTab projectId={projectId} filter="shop_drawings" />;
}