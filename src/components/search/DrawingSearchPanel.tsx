import React, { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, X, Loader2, SlidersHorizontal } from "lucide-react";
import SearchFilters, { type SearchFilterValues } from "./SearchFilters";
import SearchResultCard, { type SearchResult } from "./SearchResultCard";

interface Props {
  onClose: () => void;
  onSelectProject: (projectId: string) => void;
}

const DrawingSearchPanel: React.FC<Props> = ({ onClose, onSelectProject }) => {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<SearchFilterValues>({});
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const doSearch = useCallback(async () => {
    if (!query.trim() && !Object.values(filters).some(Boolean)) return;
    setLoading(true);
    setSearched(true);
    try {
      const body: Record<string, unknown> = { limit: 50 };
      if (query.trim()) body.q = query.trim();
      if (filters.discipline) body.discipline = filters.discipline;
      if (filters.drawing_type) body.drawing_type = filters.drawing_type;
      if (filters.revision) body.revision = filters.revision;
      if (filters.bar_mark) body.bar_mark = filters.bar_mark;
      if (filters.sort) body.sort = filters.sort;

      const { data, error } = await supabase.functions.invoke("search-drawings", { body });
      if (error) {
        console.error("Search error:", error);
        setResults([]);
      } else {
        setResults(data?.results || []);
      }
    } catch (err) {
      console.error("Search failed:", err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query, filters]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") doSearch();
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 bg-background/80 backdrop-blur-sm">
        <Search className="h-5 w-5 text-primary" />
        <h2 className="text-sm font-semibold text-foreground flex-1">Search Drawings</h2>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Search Bar */}
      <div className="px-4 py-3 border-b border-border space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search by bar mark, sheet ID, text..."
              className="pl-9 h-9 text-sm"
            />
          </div>
          <Button size="sm" onClick={doSearch} disabled={loading} className="h-9 px-4">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
          </Button>
          <Button
            size="sm"
            variant={showFilters ? "secondary" : "outline"}
            onClick={() => setShowFilters(!showFilters)}
            className="h-9"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
        </div>

        {showFilters && <SearchFilters filters={filters} onChange={setFilters} />}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}
        {!loading && searched && results.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">
            No drawings found. Try adjusting your search or filters.
          </div>
        )}
        {!loading && !searched && (
          <div className="text-center py-12 text-muted-foreground text-sm space-y-2">
            <Search className="h-8 w-8 mx-auto text-muted-foreground/40" />
            <p>Search across all your drawings by bar marks, sheet IDs, text, or metadata.</p>
          </div>
        )}
        {!loading &&
          results.map((r) => (
            <SearchResultCard key={r.id} result={r} onClick={onSelectProject} />
          ))}
      </div>
    </div>
  );
};

export default DrawingSearchPanel;
