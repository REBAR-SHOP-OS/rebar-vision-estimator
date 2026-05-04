# AI Model Configuration

## Defaults

| Knob | Value | Why |
|---|---|---|
| `temperature` | `0` | Deterministic — same input → same output. |
| `max_tokens` | `65536` | Don't truncate long structured responses. |
| `response_format` | `json_object` when emitting JSON | Avoids markdown fencing. |

## Model selection

- **Default**: `google/gemini-2.5-flash` — best cost/latency for structured extraction.
- **Reasoning-heavy**: `google/gemini-2.5-pro` or `openai/gpt-5`.
- **Vision + text**: `google/gemini-2.5-pro` (handles >3 images well).
- **Cheap classification**: `google/gemini-2.5-flash-lite`.
- **Image generation**: `google/gemini-3-pro-image-preview`.

## Hard rules

- **NEVER wrap structured envelopes** (e.g. `%%%ATOMIC_TRUTH_JSON_START%%%`) in
  markdown code fences. Emit them raw at the *very start* of the response.
- **Always handle 429 / 402** explicitly (rate limit / credits exhausted).
- **Vision payload limit**: max 3 images per call. Batch larger sets.