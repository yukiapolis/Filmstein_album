import ClientGallery from "@/components/ClientGallery";
import { requireAdminPageAuth } from "@/lib/auth/session";

type PageProps = {
  params: Promise<{ id: string }>;
};

/** Preview page at /projects/[id]/preview.
 *  ClientGallery handles its own reactive data fetching from /api/projects/[id]. */
export default async function ProjectPreviewPage({ params }: PageProps) {
  const { id } = await params;
  await requireAdminPageAuth(`/projects/${id}/preview`);
  return <ClientGallery presentation="preview" />;
}
