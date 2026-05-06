# AGENTS.md

## Cursor Cloud specific instructions

### Overview

This is a **Rebar Estimator Pro** application — an AI-powered construction blueprint analysis and rebar estimation SaaS. It is a single-package Vite + React + TypeScript frontend that connects to a **hosted Supabase** backend (PostgreSQL, Auth, Storage, Edge Functions).

### Services

| Service | How to run | Notes |
|---|---|---|
| Vite Dev Server | `npm run dev` | Serves the React SPA on port 8080 |
| Supabase (remote) | Already running | Hosted at the URL in `.env`; no local setup needed |

### Key commands

All standard commands are in `package.json` scripts:

- **Dev server**: `npm run dev` (port 8080)
- **Lint**: `npm run lint` (ESLint; note: the codebase has ~280 pre-existing lint errors, mostly `no-explicit-any` in Supabase edge functions)
- **Test**: `npm run test` (Vitest, 34 tests across 4 files)
- **Build**: `npm run build`

### Caveats

- The `.env` file contains `VITE_SUPABASE_*` credentials for the hosted Supabase instance. No local Supabase setup is required.
- Supabase Edge Functions (in `supabase/functions/`) are Deno-based and deployed remotely. They are NOT part of the local dev server. To develop/test them locally, use `supabase functions serve` (requires the Supabase CLI).
- The ESLint config lints both `src/` and `supabase/functions/`. The Supabase functions use Deno-style imports which generate many lint errors — this is expected and pre-existing.
- The Vite dev server binds to `::` (all interfaces) on port 8080.
