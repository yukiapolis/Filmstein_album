"use client";

import { useState, useRef, useEffect } from "react";
import { X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CreateProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CreateProjectDialog({ open, onClose, onSuccess }: CreateProjectDialogProps) {
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [type, setType] = useState<"Wedding" | "Event" | "Campaign">("Campaign");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);

  // Auto-focus name field when dialog opens
  useEffect(() => {
    if (open) {
      setName("");
      setClientName("");
      setType("Campaign");
      setError(null);
      setSubmitting(false);
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), clientName: clientName.trim() }),
      });
      const body = await res.json();

      if (!res.ok || body.success === false) {
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }

      onSuccess();
      onClose();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">Create New Project</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* name */}
          <div className="space-y-1.5">
            <label htmlFor="proj-name" className="text-sm font-medium text-foreground">
              Project Name <span className="text-destructive">*</span>
            </label>
            <input
              ref={nameRef}
              id="proj-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Summer Campaign 2026"
              required
              disabled={submitting}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          {/* type */}
          <div className="space-y-1.5">
            <label htmlFor="proj-type" className="text-sm font-medium text-foreground">
              Type
            </label>
            <select
              id="proj-type"
              value={type}
              onChange={(e) => setType(e.target.value as "Wedding" | "Event" | "Campaign")}
              disabled={submitting}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="Campaign">Campaign</option>
              <option value="Wedding">Wedding</option>
              <option value="Event">Event</option>
            </select>
          </div>

          {/* clientName */}
          <div className="space-y-1.5">
            <label htmlFor="proj-client" className="text-sm font-medium text-foreground">
              Client Name
            </label>
            <input
              id="proj-client"
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. Acme Co."
              disabled={submitting}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating…
                </>
              ) : (
                "Create Project"
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
