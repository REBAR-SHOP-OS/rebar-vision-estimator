import { describe, expect, it } from "vitest";

/**
 * Mirrors the de-dup gate now applied in:
 *   - src/features/workflow-v2/stages/ScopeStage.tsx (candidate list, by label)
 *   - supabase/functions/auto-estimate/index.ts (estimate rows, by desc+size)
 *   - supabase/functions/auto-bar-schedule/index.ts (estimate rows, by desc+size)
 *
 * Locks in: two PDFs (structural + architectural) describing the same element
 * MUST collapse to a single line.
 */

function dedupByLabel<T extends { label: string; confidence: number }>(rows: T[]): T[] {
  const m = new Map<string, T>();
  for (const r of rows) {
    const k = r.label.trim().toLowerCase();
    const prev = m.get(k);
    if (!prev || r.confidence > prev.confidence) m.set(k, r);
  }
  return Array.from(m.values());
}

function dedupEstimateRows<T extends { description: string; bar_size: string; confidence: number }>(rows: T[]): T[] {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const m = new Map<string, T>();
  for (const r of rows) {
    const k = `${norm(r.description)}|${r.bar_size.toUpperCase().trim()}`;
    const prev = m.get(k);
    if (!prev || r.confidence > prev.confidence) m.set(k, r);
  }
  return Array.from(m.values());
}

describe("scope + estimate de-dup gate", () => {
  it("collapses the same scope label surfaced from structural + architectural PDFs", () => {
    const out = dedupByLabel([
      { label: "Walls — Foundation/Retaining", confidence: 0.8, source: "Structural (4).pdf" },
      { label: "Walls — Foundation/Retaining", confidence: 0.75, source: "Architectural.pdf" },
      { label: "Slabs on Grade", confidence: 0.85, source: "Structural (4).pdf" },
    ]);
    expect(out).toHaveLength(2);
    const wall = out.find((c) => c.label.startsWith("Walls"));
    expect(wall?.confidence).toBe(0.8);
  });

  it("keeps the highest-confidence estimate row per (desc + bar_size)", () => {
    const out = dedupEstimateRows([
      { description: "Foundation wall vertical 15M @ 406mm O.C.", bar_size: "15M", confidence: 0.85 },
      { description: "Foundation wall vertical 15M @ 406mm O.C.", bar_size: "15M", confidence: 0.6 },
      { description: "(arch-fallback) Slab on grade 10M @ 300", bar_size: "10M", confidence: 0.5 },
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.bar_size === "15M")?.confidence).toBe(0.85);
  });
});