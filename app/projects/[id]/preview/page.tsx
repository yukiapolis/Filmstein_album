import ClientGallery from "@/components/ClientGallery";

type PageProps = {
  params: Promise<{ id: string }>;
};

/** Preview page at /projects/[id]/preview.
 *  Renders the client-facing gallery backed by mock data for now.
 *  When a real API is wired, pass the fetched photos as a prop to <ClientGallery>. */
export default async function ProjectPreviewPage({ params }: PageProps) {
  const { id } = await params;
  return <ClientGallery />;
}
