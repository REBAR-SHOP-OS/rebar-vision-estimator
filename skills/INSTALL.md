# Skills Pack — Install into a New Lovable Project

This bundle gives a fresh Lovable project the same DNA as the source app:
Trust-First UX, AI orchestration, shop-drawing-style PDF pipeline, Lovable
Cloud backend with strict RLS.

## Steps

### 1. Create the project
- New Lovable project → **enable Lovable Cloud** in Connectors.

### 2. Drop in the pack
- Unzip `skills-pack.zip` into the project root. You'll get a `skills/` folder.

### 3. Run the canonical migration
- Open `skills/00-architecture/data-model.sql`.
- Paste the SQL into the Lovable migration tool. Approve the migration.
- Confirms: `user_roles`, `profiles`, `projects`, `project_files`, `audit_events`,
  storage bucket `uploads` with owner-pathed RLS.

### 4. Wire the contexts
- Copy `skills/01-auth-and-rls/auth-context.tsx` → `src/contexts/AuthContext.tsx`.
- Copy `skills/09-i18n-and-theme/{LanguageContext,ThemeContext}.tsx` → `src/contexts/`.
- In `src/App.tsx`, wrap the router:
  ```tsx
  <AuthProvider><ThemeProvider><LanguageProvider>{children}</LanguageProvider></ThemeProvider></AuthProvider>
  ```

### 5. Drop in the libs
- `skills/03-pdf-pipeline/pdf-to-images.ts` → `src/lib/pdf-to-images.ts`.
  Then `bun add pdfjs-dist`.
- `skills/06-shop-drawing-engine/validate-metadata.ts` → `src/lib/shop-drawing/validate-metadata.ts`.
- `skills/06-shop-drawing-engine/sheet-sizes.ts` → `src/lib/shop-drawing/sheet-sizes.ts`.
- `skills/06-shop-drawing-engine/sheet-templates/*` → `src/lib/shop-drawing/templates/`.
- `skills/02-cloud-storage-pathing/upload-helpers.ts` → `src/lib/upload-helpers.ts`.

### 6. Drop in the UI shell (optional but recommended)
- `skills/05-trust-first-ux/{StatusBanner,EvidenceDrawer,EstimateGrid}.tsx` → `src/components/workspace/`.

### 7. Edge functions
- Copy `skills/07-edge-functions/_template/` → `supabase/functions/_template/`.
- For each new function, start from the template (CORS + auth + JSON envelope).
- `skills/07-edge-functions/{draft-shop-drawing-ai,analyze-blueprint}.ts` are
  reference shells — wire them to the AI gateway using `skills/04-ai-gateway/call-ai.ts`.

### 8. Smoke test
- Sign up → confirms `profiles` trigger works.
- Upload a file via `uploadToProject({...})` → confirms storage RLS.
- Insert an `audit_events` row → confirms audit RLS.

## Conventions to enforce on day one
- Read `skills/10-conventions/*` — minimum-patch policy, sentinel pattern,
  session-expiry handling, audit logging.
- Read `skills/04-ai-gateway/model-config.md` — deterministic settings.
- Read `skills/00-architecture/pipeline-overview.md` — hard limits.

## What this pack does NOT do
- Doesn't auto-create a Lovable project. You make the project; the pack is
  source you copy in.
- Doesn't ship domain logic (rebar weights, RSIC standards, CRM hooks).
  Add your own domain tables on top of the canonical baseline.
