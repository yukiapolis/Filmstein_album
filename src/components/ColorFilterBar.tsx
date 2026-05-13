"use client";

import { colorLabelMap, type ColorLabel } from "@/data/mockData";

const allColors: ColorLabel[] = ["red", "green", "blue", "yellow", "purple"];

interface ColorFilterBarProps {
  active: ColorLabel | "all";
  onChange: (c: ColorLabel | "all") => void;
  selectedColors?: ColorLabel[];
  onToggleColor?: (color: ColorLabel) => void;
}

const ColorFilterBar = ({ active, onChange, selectedColors, onToggleColor }: ColorFilterBarProps) => {
  const isMulti = Array.isArray(selectedColors) && typeof onToggleColor === 'function'

  return (
    <div className="w-full overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      <div className="inline-flex min-w-max items-center gap-2 pr-2">
        <button
        type="button"
        onClick={() => isMulti ? allColors.forEach((color) => selectedColors.includes(color) && onToggleColor(color)) : onChange("all")}
        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
          isMulti
            ? (selectedColors.length === 0 ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground")
            : (active === "all" ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground")
        }`}
      >
        All
      </button>
        {allColors.map((c) => {
          const info = colorLabelMap[c];
          const activeState = isMulti ? selectedColors.includes(c) : active === c
          return (
            <button
              key={c}
              type="button"
              onClick={() => isMulti ? onToggleColor(c) : onChange(c)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                activeState
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
    </div>
  );
};

export default ColorFilterBar;
