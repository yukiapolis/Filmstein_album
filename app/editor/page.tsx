import Link from "next/link";

/** Placeholder until the editor workspace is migrated. */
export default function EditorPage() {
  return (
    <div className="container py-8 space-y-4">
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back to Projects
      </Link>
      <h1 className="text-2xl font-bold text-foreground">Editor</h1>
      <p className="text-sm text-muted-foreground">Editor workspace is not available yet.</p>
    </div>
  );
}
