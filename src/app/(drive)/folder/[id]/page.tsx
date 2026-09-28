import { ExplorerClient } from "@/components/explorer/ExplorerClient";

export default async function FolderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ExplorerClient folderId={id} />;
}
