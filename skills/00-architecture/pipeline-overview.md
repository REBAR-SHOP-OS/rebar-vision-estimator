# Pipeline Overview

```text
 Upload  ──►  Parse (PDF/Image)  ──►  Extract (AI + OCR)
    │                                       │
    ▼                                       ▼
 Storage (RLS)                       Atomic Truth JSON
                                            │
                                            ▼
                                  Validation Gates (6)
                                            │
                  ┌─────────────────────────┼─────────────────────────┐
                  ▼                         ▼                         ▼
           AI Candidate             Review Draft                 Issued
         (sketch, fast)         (reviewer workflow)         (deterministic)
```

## Layers

- **Ingest** — `03-pdf-pipeline` (browser fallback for big files).
- **Extract** — `04-ai-gateway` + edge functions in `07-edge-functions`.
- **Validate** — `06-shop-drawing-engine/validate-metadata.ts` style gates.
- **Render** — `06-shop-drawing-engine/sheet-templates/*` + `08-export-utilities`.
- **Audit** — `10-conventions/audit-logging.md`.

## Hard limits to remember

- Edge functions: <150 MB RAM, ~500 KB JSON payload, max 3 Vision images.
- PDFs >3 MB: render client-side, upload pages to storage, send signed URLs.
- AI calls: deterministic (`temperature: 0`, `max_tokens: 65536`).
- JSON envelopes: never wrap in markdown fences. Emit raw at start of response.