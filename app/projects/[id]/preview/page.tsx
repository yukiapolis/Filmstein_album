import Link from "next/link";

type PageProps = {
  params: Promise<{ id: string }>;
};

/** Placeholder so Preview from project detail resolves; migrate ClientGallery later. */
export default async function ProjectPreviewPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <div className="container py-8 space-y-4">
      <Link href={`/projects/${id}`} className="text-sm text-muted-foreground hover:text-foreground">
        ← Back to project
      </Link>
      <h1 className="text-2xl font-bold text-foreground">Preview</h1>
      <p className="text-sm text-muted-foreground">Project ID: {id}</p>
    </div>
  );
}
