

# Auto-Detect Rebar Coating from Drawings

## Problem
The rebar coating field in the Scope Definition Panel always defaults to "Black Steel (Standard)" regardless of what the drawings specify. If general notes mention epoxy, galvanized, or stainless steel, the user must manually change it. This is a pricing-critical field that should be auto-detected and flagged.

## Solution
Add coating detection to the project type detection pipeline and auto-populate the scope panel with alerts.

### Changes

**1. `supabase/functions/detect-project-type/index.ts`**
- Add coating keywords to OCR keyword analysis: `epoxy`, `epoxy-coated`, `ecr`, `galvanized`, `galvanised`, `stainless`, `stainless steel`, `mmfx`, `chromium`
- Add `detectedCoating` field to the tool call schema (enum: `none`, `EPOXY`, `GALVANISED`, `STAINLESS`, `MMFX`)
- Include coating keyword hints in the AI prompt
- Pass `detectedCoating` through in the response

**2. `src/components/chat/ScopeDefinitionPanel.tsx`**
- Extend `DetectionResult` interface with `detectedCoating?: string`
- In the `useEffect` that applies detection results, map `detectedCoating` to the internal coating ID (`EPOXY` → `epoxy_coated`, `GALVANISED` → `galvanized`, `STAINLESS` → `stainless_steel`) and call `setRebarCoating()`
- Show an amber alert banner when non-standard coating is detected: "⚠ Coating Detected: Epoxy-Coated — pricing multiplier (1.20x) will be applied automatically"
- Update `buildScopeFromDetection()` to also use `detectedCoating` instead of always defaulting to `black_steel`

**3. Coating-to-ID mapping**

| AI Output | Scope Panel ID | Multiplier |
|-----------|---------------|------------|
| `EPOXY` | `epoxy_coated` | 1.20x |
| `GALVANISED` | `galvanized` | 1.35x |
| `STAINLESS` | `stainless_steel` | 6.0x |
| `MMFX` | `black_steel` + warning | 1.50x |
| `none` / absent | `black_steel` | 1.0x |

**4. Alert banner in scope panel** (new section above the coating radio buttons)
When `detectedCoating` is non-standard, render an amber banner:
- Icon: AlertTriangle
- Text: "Coating detected from drawings: **{label}** — pricing multiplier ({mult}x) will apply"
- The coating radio is pre-selected but user can override

No database changes needed. The coating field already flows through `scopeData.rebarCoating` → `analyze-blueprint` prompt → element extraction → pricing.

