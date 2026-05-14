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
  compact = false,
}: SnapflareLogoProps) {
  return (
    <span className={cn("inline-flex items-center", className)}>
      <img
        src={compact ? "/branding/snapflare-horizontal.svg" : "/branding/snapflare-stacked.svg"}
        alt="Snapflare by filmstein.com"
        className={cn(
          "block h-auto",
          compact ? "w-[8.75rem]" : "w-[11.5rem] max-w-full",
          markClassName,
        )}
      />
    </span>
  );
}
