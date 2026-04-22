

# Upgrade "Generate Draft" + "AI Visual" to GPT Image 1.5

Both buttons highlighted in your screenshots (`Drawings tab → Generate Draft` per-segment, and `Outputs tab → AI Visual` per-project) hit the same edge function: `draft-shop-drawing-ai`. This patch upgrades only the OpenAI path inside that function — no UI changes, no other files.

## Single-file patch

**`supabase/functions/draft-shop-drawing-ai/index.ts`** (~15 lines changed)

1. **Model bump**
   - `OPENAI_MODEL = "gpt-image-1.5"` (was `gpt-image-1`)
   - Add `OPENAI_PLANNER_MODEL = "gpt-4.1"` for one-shot prompt refinement
   - Keep size `1536x1024` and quality `high`

2. **New helper `refinePromptOpenAI(rawPrompt, apiKey)`**
   - One call to `gpt-4.1` chat completions
   - System: "You are a CAD detailer. Tighten this shop-drawing prompt for an image model. Preserve all bar marks, dimensions, gridlines, hatches, and title-block content. Output only the refined prompt."
   - On any failure → return the original prompt (non-blocking fallback)

3. **Wire into the OpenAI branch only**
   - Inside `generateImageOpenAI`, refine the prompt once per segment before calling `/v1/images/generations`
   - Add 404-fallback: if `gpt-image-1.5` returns 404 (not yet enabled on the account), retry once with `gpt-image-1` so the button never hard-fails

4. **Logging**
   - Add `planner_model` and `image_model_used` to the existing structured `console.log`

## Untouched

- Lovable AI / Gemini Nano-Banana branch (used when `provider !== "openai"`)
- Frontend (`DrawingViewsPanel.tsx`, `OutputsTab.tsx`) — already passes `provider`
- Prompt template `buildPrompt(...)` — kept as-is; planner only refines its output
- DB schema, RLS, config.toml

## Risk

Low. Worst case `gpt-image-1.5` is unavailable → automatic fallback to `gpt-image-1` (current behavior). Existing 429 / 402 handling preserved.

