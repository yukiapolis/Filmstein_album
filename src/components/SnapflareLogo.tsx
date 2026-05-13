import { cn } from "@/lib/utils";

type SnapflareLogoProps = {
  className?: string;
  markClassName?: string;
  wordmarkClassName?: string;
  subtitleClassName?: string;
  compact?: boolean;
};

export default function SnapflareLogo({
  className,
  markClassName,
  wordmarkClassName,
  subtitleClassName,
  compact = false,
}: SnapflareLogoProps) {
  return (
    <span className={cn("inline-flex items-center", compact ? "gap-2.5" : "gap-3", className)}>
      <svg
        viewBox="0 0 120 62"
        aria-hidden="true"
        className={cn("shrink-0 text-foreground", compact ? "h-8 w-[3.9rem]" : "h-10 w-[4.8rem]", markClassName)}
        fill="none"
      >
        <path
          d="M28 35C28 21.4 39.6 10 54 10C68.4 10 80 21.4 80 35"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <path
          d="M8 49C36 45 64 40 112 38C80 43 48 50 20 55H8V49Z"
          fill="currentColor"
        />
      </svg>

      <span className="flex min-w-0 flex-col leading-none">
        <span className={cn("font-medium tracking-[-0.03em] text-foreground", compact ? "text-[2rem]" : "text-[2.2rem]", wordmarkClassName)}>
          snapflare
        </span>
        <span className={cn("mt-1 text-foreground/90", compact ? "pl-1 text-[0.95rem]" : "pl-1.5 text-[1rem]", subtitleClassName)}>
          by filmstein
        </span>
      </span>
    </span>
  );
}
