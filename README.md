# Rebar Vision Estimator

AI-assisted rebar takeoff, estimation, review, quoting, and CRM handoff — built with React and Supabase.

---

## Overview

This application lets structural estimators upload construction blueprints (PDF), automatically extract rebar schedules using OCR (Google Cloud Vision) and LLM inference (Gemini), review and approve estimates through a multi-stage workflow, generate PDF/Excel quotes, and sync deals to an Odoo CRM.

### Key capabilities

| Capability | Description |
|---|---|
| Blueprint OCR | Multi-pass Google Cloud Vision extraction with triple OCR fallback |
| AI Estimation | Gemini-powered segment estimation against drawing text evidence |
| Verified Pipeline | Canonical estimate snapshot with export-gate (provenance, confidence, ref diff) |
| Approval chain | estimation_ready → ben_approved → neel_approved → sent_to_customer |
| Review sharing | Public token links for external reviewer comments |
| CRM sync | Odoo JSON-RPC integration (local fallback when unconfigured) |
| Multi-language UI | English, Persian, Arabic, French, Spanish, German, Turkish, Chinese, Hindi, Portuguese |

---

## System workflow diagram

The main system workflow is documented in [`docs/system-workflow.md`](docs/system-workflow.md).

It includes:

- an end-to-end application flow diagram
- the persisted project pipeline state machine
- the review, quoting, and CRM sync path

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite 7, Tailwind CSS, shadcn/ui |
| State management | TanStack Query v5 |
| Backend / DB | Supabase (Postgres + RLS, Storage, Auth) |
| Edge Functions | Deno (TypeScript) — 26 functions |
| Vision / OCR | Google Cloud Vision API |
| LLM | Gemini via Lovable AI Gateway |
| Export | ExcelJS (XLSX), jsPDF (PDF) |
| Tests | Vitest + jsdom |

---

## Getting started

### Prerequisites

- Node.js ≥ 18 (or Bun)
- A Supabase project

### 1 — Clone and install

```sh
git clone <YOUR_GIT_URL>
cd rebar-vision-estimator
npm install
```

### 2 — Configure environment

```sh
cp .env.example .env
# Fill in VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY
```

> **Never commit `.env` to version control.** It is excluded by `.gitignore`.

### 3 — Start the dev server

```sh
npm run dev   # http://localhost:8080
```

---

## Available scripts

| Script | Description |
|---|---|
| `npm run dev` | Start Vite dev server (HMR) |
| `npm run build` | Production build |
| `npm run build:dev` | Development build |
| `npm run preview` | Preview production build |
| `npm run lint` | ESLint |
| `npm run test` | Run all tests (Vitest) |
| `npm run test:watch` | Vitest watch mode |

---

## Supabase Edge Functions

Edge functions live in `supabase/functions/`. Shared utilities are in `supabase/functions/_shared/`:

| Shared module | Purpose |
|---|---|
| `_shared/cors.ts` | CORS headers (respects `ALLOWED_ORIGIN` env var) |
| `_shared/google-vision.ts` | Google Cloud Vision auth + annotation helpers |

### Required secrets (set via `supabase secrets set`)

| Secret | Purpose |
|---|---|
| `GOOGLE_VISION_SA_KEY_V2` | Google Cloud service-account JSON for OCR |
| `LOVABLE_API_KEY` | Lovable AI Gateway key for LLM estimation |
| `ALLOWED_ORIGIN` | Restrict CORS to your production URL (optional, defaults to `*`) |
| `ODOO_URL` | Odoo instance URL (optional) |
| `ODOO_DATABASE` | Odoo database name (optional) |
| `ODOO_USERNAME` | Odoo login user (optional) |
| `ODOO_API_KEY` | Odoo API key (optional) |

---

## Project structure

```
src/
  pages/          # Route-level React components
  components/
    chat/         # Chat area, estimation UI, bar list tables
    workspace/    # Project workspace tabs and panels
    dashboard/    # Dashboard, quote workflow, approval
    audit/        # Outcome capture, reconciliation
    crm/          # CRM sync panels
    layout/       # App shell, sidebar
    ui/           # shadcn/ui primitives
  contexts/       # AuthContext, ThemeContext, LanguageContext
  lib/
    rebar-weights.ts           # CSA / imperial weight tables (single source of truth)
    verified-estimate/         # Export-gate, canonical types, reference diff
    pdf-export.ts / excel-export.ts / quote-pdf-export.ts
    audit-logger.ts
  integrations/supabase/       # Generated client + type definitions
  test/           # Vitest regression tests

supabase/
  functions/      # 26 Deno edge functions
    _shared/      # Shared helpers (cors, google-vision)
  migrations/     # 28 Postgres migrations (schema history)
  config.toml
```

---

## Running tests

```sh
npm run test
```

Tests cover:
- Rebar weight table accuracy (CSA G30.18 metric + imperial)
- Unit detection from spreadsheet column headers
- Project-type detection veto logic (cage_only vs building signals)
- Weight accuracy regression against real project fixtures
- Export-gate threshold classification

---

## Deployment

Open [Lovable](https://lovable.dev/projects/ylfvyurpqplbijjfuuns) and click **Share → Publish**.

To connect a custom domain: **Project → Settings → Domains → Connect Domain**.

