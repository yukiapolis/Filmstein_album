import ProjectDetailView from "@/components/ProjectDetailView";
import { requireAdminPageAuth } from "@/lib/auth/session";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ProjectDetailPage({ params }: PageProps) {
  const { id } = await params;
  await requireAdminPageAuth(`/projects/${id}`);
  return <ProjectDetailView projectId={id} />;
}
