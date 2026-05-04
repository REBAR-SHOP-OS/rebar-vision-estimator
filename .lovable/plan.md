# Skills Pack — Portable Foundation to Rebuild This App

You want to clone the *capability* of this app (Trust-First estimation + shop-drawing pipeline + AI orchestration) into a new Lovable project. We'll package everything reusable into a single drop-in folder + docs bundle, so a new project can boot from it instead of starting from scratch.

This is a **packaging task**, not a feature change to the live app. Nothing in the running product moves.

## Deliverable

A new top-level folder `skills/` in this repo containing 10 self-contained skill modules, plus a `/mnt/documents/skills-pack.zip` artifact you can download and drop into a new Lovable project.

```text
skills/
  README.md                          ← how to install into a new project
  00-architecture/
    product-vision.md
    pipeline-overview.md
    data-model.sql                   ← canonical tables + RLS
  01-auth-and-rls/
    auth-context.tsx
    user-roles.sql
    rls-patterns.md
  02-cloud-storage-pathing/
    storage-rls.sql
    upload-helpers.ts
  03-pdf-pipeline/
    pdf-to-images.ts                 ← copied + generalized
    client-side-render.md
  04-ai-gateway/
    call-ai.ts                       ← typed wrapper (text + JSON + vision)
    prompts/
      atomic-truth.md
      shop-drawing-ai.md
      validation-gates.md
    model-config.md                  ← deterministic settings rules
  05-trust-first-ux/
    StatusBanner.tsx
    EvidenceDrawer.tsx
    EstimateGrid.tsx
    workspace-layout.md
  06-shop-drawing-engine/
    validate-metadata.ts             ← copied
    sheet-templates/
      ai-candidate.html.ts
      review-draft.html.ts
      issued.html.ts
    sheet-sizes.ts                   ← ARCH C/D/E sizing
    render-html-to-pdf.md
  07-edge-functions/
    _template/
      index.ts                       ← thin-router skeleton
      cors.ts
    draft-shop-drawing-ai.ts         ← reference impl
    analyze-blueprint.ts             ← reference impl
  08-export-utilities/
    excel-export.ts
    pdf-export.ts
    quote-pdf-export.ts
  09-i18n-and-theme/
    LanguageContext.tsx
    ThemeContext.tsx
    languages.md                     ← 10-language matrix, RTL/LTR
  10-conventions/
    minimum-patch-policy.md
    select-sentinel.md
    session-expiry-handling.md
    audit-logging.md
```

Plus: `/mnt/documents/skills-pack.zip` (same tree, zipped) and `/mnt/documents/skills-pack-INSTALL.md` (step-by-step bootstrap for a fresh Lovable project).

## How it gets built (default mode work)

1. **Inventory** — read the canonical sources already in this repo:
   - `src/lib/pdf-to-images.ts`, `src/lib/shop-drawing/validate-metadata.ts`
   - `src/lib/excel-export.ts`, `src/lib/pdf-export.ts`, `src/lib/quote-pdf-export.ts`
   - `src/contexts/{Auth,Language,Theme}Context.tsx`
   - `src/components/workspace/{StatusBanner,EvidenceDrawer,EstimateGrid,WorkspaceLayout}.tsx`
   - `supabase/functions/draft-shop-drawing-ai/index.ts`, `analyze-blueprint/index.ts`
   - `supabase/config.toml`, `src/integrations/supabase/types.ts` (for schema reference)
   - All `mem://` files for the architecture/logic/feature docs.

2. **Generalize** — for each copy, strip project-specific identifiers (rebar terms, RSIC references, Odoo CRM hooks) and replace with `// PROJECT-SPECIFIC: replace with your domain` comments. Keep the *patterns* (RLS shape, thin-router structure, validation pipeline, sheet sizing, AI prompt skeleton).

3. **Write docs** — each skill folder gets a short `README.md` explaining:
   - what the skill does
   - which files to drop in
   - which env vars / secrets it needs
   - which DB tables/RLS it requires
   - copy-paste install snippet

4. **Generate canonical SQL** — extract the reusable schema (projects, project_files, user_roles, audit_events, shop_drawings, export_jobs, storage buckets + RLS) into `00-architecture/data-model.sql` as a single runnable migration.

5. **Bundle** — zip `skills/` to `/mnt/documents/skills-pack.zip` and emit a `<lov-artifact>` so you can download it.

6. **Bootstrap doc** — `skills-pack-INSTALL.md` walks through:
   - Create new Lovable project → enable Lovable Cloud
   - Unzip pack into repo root
   - Run `data-model.sql` migration
   - Wire `AuthContext`, `LanguageContext`, `ThemeContext` into `App.tsx`
   - Deploy edge function template
   - Smoke-test with the included sample prompt

## What's deliberately NOT in scope

- No changes to the running app's code, DB, or edge functions.
- Domain-specific business rules (rebar weights, RSIC standards, Odoo CRM, agent brain) stay in this project — they are *not* generic skills. The pack ships the *patterns* (validation gates, learning loop shape, audit logging) without the domain payload.
- No new Lovable project is created automatically — the pack is portable; you create the new project and drop it in.

## Acceptance check

- `skills/` exists with all 10 subfolders and a top-level README.
- Every skill folder has at least one code file + a README.
- `data-model.sql` runs cleanly on a fresh Lovable Cloud project (syntax-validated, not executed against this DB).
- `/mnt/documents/skills-pack.zip` downloads and unzips to the same tree.
- `skills-pack-INSTALL.md` lists every step needed to boot a new app.

## Estimated size / effort

- ~25 new files in `skills/`, no edits to existing code.
- One zip artifact.
- ~30 min of generation, no DB migrations, no edge function deploys.

## Out of scope (follow-up if you want it)

- Auto-creating the second Lovable project from this pack (needs you to click "New Project" first).
- A CLI installer that runs the SQL + wires contexts automatically.
- Domain-specialized skill packs (e.g. a "Concrete Estimation" pack vs a generic one).
