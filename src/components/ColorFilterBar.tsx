"use client";

import { colorLabelMap, type ColorLabel } from "@/data/mockData";

const allColors: ColorLabel[] = ["red", "green", "blue", "yellow", "purple"];

interface ColorFilterBarProps {
  active: ColorLabel | "all";
  onChange: (c: ColorLabel | "all") => void;
}

const ColorFilterBar = ({ active, onChange }: ColorFilterBarProps) => {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onChange("all")}
        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
          active === "all"
            ? "bg-foreground text-background"
            : "bg-muted text-muted-foreground hover:text-foreground"
        }`}
      >
        All
      </button>
      {allColors.map((c) => {
        const info = colorLabelMap[c];
        return (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              active === c
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${info.bg}`} />
            {info.label}
          </button>
        );
      })}
    </div>
  );
};

export default ColorFilterBar;
