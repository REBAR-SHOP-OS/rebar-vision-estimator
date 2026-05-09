# UI Unification & Dashboard Visibility Fix

## What's actually broken

I audited the app end-to-end. There are **three competing visual systems** running at the same time, which is why the dashboard looks washed-out and nothing aligns:

1. **Semantic tokens** (`--background`, `--primary`, `--card`, …) — used by most pages (Workspace, Orders, Standards, Auth, Landing). Has full light + dark variants. ✅ correct system.
2. **`industrial-*` palette** (`--industrial-surface`, `--industrial-primary`, …) — used **only** by `RebarForgeDashboard.tsx`. Defined only for light mode; **no `.dark` overrides exist**, so in dark mode the dashboard renders dark text on dark backgrounds → "colors not visible". Also clashes tonally (peach/cream + burnt orange) with the rest of the app (teal primary on warm-stone background).
3. **Hardcoded hex** in shell chrome — `AppShell` uses `bg-[linear-gradient(180deg,#f7f3ec…)]` and `bg-white` chips; `AppSidebar` uses `bg-[#141c20]`, `text-slate-100`, `text-slate-300`, `hover:bg-white/8`, `text-rose-300`. Bypasses the theme entirely → sidebar stays dark even in light mode and ignores any token change.

`QAStage.tsx` also has stray `bg-[#…]` hex.

## The fix — one design system, everywhere

### 1. Remove the `industrial-*` palette completely
- Delete the `--industrial-*` block from `src/index.css`.
- Delete the `industrial: { … }` color group from `tailwind.config.ts`.
- Rewrite `src/components/dashboard/RebarForgeDashboard.tsx` to use semantic tokens only:

| Old | New |
|---|---|
| `bg-industrial-surface` | `bg-background` |
| `bg-industrial-surface-low` | `bg-muted` |
| `bg-industrial-surface-high` | `bg-secondary` |
| `text-industrial-on-surface` | `text-foreground` |
| `text-industrial-on-variant` | `text-muted-foreground` |
| `text-industrial-primary` | `text-primary` |
| `bg-industrial-primary` / `text-industrial-on-primary` | `bg-primary` / `text-primary-foreground` |
| `border-industrial-outline-variant` | `border-border` |
| `bg-industrial-error-container` / `text-industrial-error` | `bg-destructive/10` / `text-destructive` |
| Hero card `bg-white` | `bg-card` |

Drop the wrapper class `industrial-theme` and the `font-['Inter',…]` override (already global). Keep all layout, typography sizing, and component structure untouched — it's a className swap only.

### 2. Tokenise `AppShell` chrome
- Replace `bg-[linear-gradient(180deg,#f7f3ec…)]` → `bg-background`.
- Replace every `bg-white` / `border-slate-200` / `text-slate-*` chip in the header with `bg-card` / `border-border` / `text-muted-foreground` / `text-foreground`.
- `SidebarTrigger` chip → `bg-card border-border text-foreground hover:bg-muted`.

### 3. Tokenise `AppSidebar`
The sidebar already has dedicated tokens (`--sidebar-background`, `--sidebar-foreground`, `--sidebar-accent`, `--sidebar-border`, `--sidebar-primary`) defined for both light and dark modes — they're just not being used.
- Replace `bg-[#141c20]` → `bg-sidebar`.
- `text-slate-100` / `text-slate-200` / `text-slate-300` → `text-sidebar-foreground`.
- `hover:bg-white/8 hover:text-white` → `hover:bg-sidebar-accent hover:text-sidebar-accent-foreground`.
- `data-[active=true]:bg-teal-500/15 data-[active=true]:text-white` → `data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-primary`.
- `border-white/10` → `border-sidebar-border`.
- Sign-out hover: `hover:text-rose-300` → `hover:text-destructive`.

### 4. Tokenise `QAStage`
Swap remaining `bg-[#…]` / `text-[#…]` for semantic equivalents (`bg-card`, `text-foreground`, `text-muted-foreground`, status colors via `text-destructive` / `text-status-*` already in tokens).

### 5. Verify
- Toggle light ↔ dark on `/app`, `/app/orders`, `/app/standards`, `/app/project/:id` — every surface should respond.
- Confirm dashboard cards, KPIs, hero CTA, and "Recent Projects" rows all have visible contrast in both themes.
- Confirm sidebar follows the theme (light cream sidebar in light mode, deep slate in dark) instead of being permanently dark.

## Files touched (4 source files + 2 config)

```text
src/index.css                                   – remove --industrial-* block
tailwind.config.ts                              – remove industrial color group
src/components/dashboard/RebarForgeDashboard.tsx – className swap only, no logic change
src/components/layout/AppShell.tsx              – tokenise header + bg
src/components/layout/AppSidebar.tsx            – tokenise sidebar surfaces
src/features/workflow-v2/stages/QAStage.tsx    – swap hex for tokens
```

No business logic, no edge functions, no DB, no routes touched. Pure presentation cleanup.

## Out of scope (ask if you want these too)
- Restyling `LandingPage` (already on the unified palette — left as-is).
- Adding new theme variants or a redesign — this plan only **unifies** what's there.
- Changing the chosen brand colors (teal primary on warm-stone background stays as the single source of truth).
