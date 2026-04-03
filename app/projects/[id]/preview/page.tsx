import ClientGallery from "@/components/ClientGallery";

type PageProps = {
  params: Promise<{ id: string }>;
};

/** Preview page at /projects/[id]/preview.
 *  ClientGallery handles its own reactive data fetching from /api/projects/[id]. */
export default async function ProjectPreviewPage(_props: PageProps) {
  return <ClientGallery presentation="preview" />;
}
