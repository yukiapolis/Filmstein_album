import ClientGallery from "@/components/ClientGallery";

type PageProps = {
  params: Promise<{ id: string }>;
};

/** Public share page at /share/[id].
 *  Renders ClientGallery which fetches its own data reactively from /api/projects/[id]. */
export default async function SharePage(_props: PageProps) {
  return <ClientGallery presentation="preview" />;
}
