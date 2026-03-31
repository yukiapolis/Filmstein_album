import Link from "next/link";
import { Aperture } from "lucide-react";

const Navbar = () => {
  return (
    <header className="border-b border-border bg-card">
      <div className="container flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Aperture className="h-6 w-6 text-primary" />
          <span className="text-lg font-semibold text-foreground">Snapflare</span>
        </Link>
        <nav className="flex items-center gap-6 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground transition-colors">Projects</Link>
          <Link href="/editor" className="hover:text-foreground transition-colors">Editor</Link>
          <Link href="/editor" className="hover:text-foreground transition-colors">Editor</Link>
          <div className="ml-4 h-8 w-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-medium">
            JD
          </div>
        </nav>
      </div>
    </header>
  );
};

export default Navbar;
