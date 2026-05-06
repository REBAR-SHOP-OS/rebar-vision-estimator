# Skills Pack

Portable bundle of patterns, code, and docs to spin up another Lovable app
with the same DNA as this one (Trust-First UX + AI orchestration + shop-drawing
style PDF pipeline + Lovable Cloud backend).

## What's inside

| Folder | Skill |
|---|---|
| `00-architecture/` | Product vision, pipeline overview, canonical SQL schema |
| `01-auth-and-rls/` | AuthContext, user_roles table, RLS patterns |
| `02-cloud-storage-pathing/` | `${userId}/${projectId}/...` storage RLS |
| `03-pdf-pipeline/` | Client-side PDF → PNG renderer (browser fallback) |
| `04-ai-gateway/` | Typed call wrapper, prompt skeletons, model config |
| `05-trust-first-ux/` | 3-pane workspace layout (status / grid / evidence) |
| `06-shop-drawing-engine/` | Metadata validator, sheet sizing, HTML templates |
| `07-edge-functions/` | Thin-router skeleton + reference implementations |
| `08-export-utilities/` | Excel/PDF/Quote export patterns |
| `09-i18n-and-theme/` | Language + Theme contexts, 10-language matrix |
| `10-conventions/` | Minimum-patch policy, sentinel pattern, audit logging |

## Install into a new Lovable project

See `/mnt/documents/skills-pack-INSTALL.md` for the full bootstrap walkthrough.

Quick start:

1. Create a new Lovable project, enable **Lovable Cloud**.
2. Copy `skills/` into the new project root.
3. Run `00-architecture/data-model.sql` via the migration tool.
4. Drop the contexts from `01` / `09` into `src/contexts/` and wrap `App.tsx`.
5. Drop the libs from `03` / `06` / `08` into `src/lib/`.
6. Use `07-edge-functions/_template/` as the basis for any new edge function.

## What this pack is NOT

- Not a runtime dependency. It's source you copy in and modify.
- Not domain-specific. Rebar/RSIC/Odoo logic stays in the original app.
- Not an automated installer. You wire it manually (it's small).