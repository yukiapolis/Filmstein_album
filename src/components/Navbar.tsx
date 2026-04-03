import Link from "next/link";
import { Aperture } from "lucide-react";
import type { ReactNode } from "react";

const Navbar = ({ breadcrumb, actions }: { breadcrumb?: ReactNode; actions?: ReactNode }) => {
  return (
    <header className="border-b border-border bg-card">
      <div className="container flex h-16 items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <Aperture className="h-6 w-6 text-primary" />
            <span className="text-lg font-semibold text-foreground">Snapflare</span>
          </Link>
          {breadcrumb && <div className="min-w-0">{breadcrumb}</div>}
        </div>
        <div className="flex items-center gap-3">
          {actions}
          <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-medium">
            JD
          </div>
        </div>
      </div>
    </header>
  );
};

export default Navbar;
