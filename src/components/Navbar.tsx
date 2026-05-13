"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Aperture, Check, Copy, LogOut } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

type CurrentAdminUser = {
  id: string;
  shortId: string;
  username: string;
  role: "super_admin" | "admin";
};

const Navbar = ({ breadcrumb, actions }: { breadcrumb?: ReactNode; actions?: ReactNode }) => {
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<CurrentAdminUser | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    let cancelled = false;

    const loadCurrentUser = async () => {
      try {
        const res = await fetch("/api/admin/me");
        const body = (await res.json().catch(() => ({}))) as { success?: boolean; data?: CurrentAdminUser };
        if (!cancelled && res.ok && body.success && body.data) {
          setCurrentUser(body.data);
        }
      } catch {
        // ignore
      }
    };

    void loadCurrentUser();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [menuOpen]);

  const initials = useMemo(() => {
    const source = currentUser?.username?.trim() || "AD";
    return source.slice(0, 2).toUpperCase();
  }, [currentUser?.username]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };

  const handleCopyUuid = async () => {
    if (!currentUser?.id) return;

    try {
      await navigator.clipboard.writeText(currentUser.shortId);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1600);
    } catch {
      setCopyState("failed");
      window.setTimeout(() => setCopyState("idle"), 1600);
    }
  };

  return (
    <header className="border-b border-border bg-card">
      <div className="container flex h-16 items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <Aperture className="h-6 w-6 text-primary" />
            <span className="flex flex-col items-start leading-none">
              <span className="text-lg font-semibold text-foreground">Snapflare</span>
              <span className="mt-px text-[11px] font-medium tracking-[0.02em] text-muted-foreground">by filmstein</span>
            </span>
          </Link>
          {breadcrumb && <div className="min-w-0">{breadcrumb}</div>}
        </div>
        <div className="flex items-center gap-3">
          {actions}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-left text-xs font-medium text-primary-foreground transition hover:opacity-90"
              aria-label="Open account menu"
            >
              {initials}
            </button>

            {menuOpen ? (
              <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-border bg-card p-3 shadow-xl">
                <div className="space-y-1 border-b border-border pb-3">
                  <p className="text-sm font-medium text-foreground">{currentUser?.username || "Admin"}</p>
                  <p className="text-xs text-muted-foreground">{currentUser?.role === "super_admin" ? "Super admin" : "Admin"}</p>
                </div>

                <div className="space-y-2 py-3">
                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground">Your short ID</p>
                        <p className="mt-1 break-all text-xs text-muted-foreground">{currentUser?.shortId || "Loading…"}</p>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={() => void handleCopyUuid()} disabled={!currentUser?.id}>
                        {copyState === "copied" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        {copyState === "copied" ? "Copied" : copyState === "failed" ? "Retry" : "Copy"}
                      </Button>
                    </div>
                  </div>
                </div>

                <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={handleLogout}>
                  <LogOut className="h-4 w-4" />
                  Logout
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Navbar;
