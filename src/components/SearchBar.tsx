import { Search } from "lucide-react";

const SearchBar = ({
  placeholder = "Search projects...",
  value,
  onChange,
}: {
  placeholder?: string
  value?: string
  onChange?: (value: string) => void
}) => {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        className="h-10 w-full rounded-lg border border-input bg-background pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
      />
    </div>
  );
};

export default SearchBar;
