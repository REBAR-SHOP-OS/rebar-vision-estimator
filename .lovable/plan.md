## Goal

Add a delete action to each project card in the Dashboard's **Recent Projects** grid (highlighted area in the screenshot), so the user can remove a project directly without opening it.

## Changes (minimal patch)

### 1. `src/pages/Dashboard.tsx`
- Add `handleDeleteProject(id)`:
  - `window.confirm("Delete this project? This cannot be undone.")`
  - `await supabase.from("projects").delete().eq("id", id)`
  - On success: toast + remove from `projects` state (optimistic, no refetch needed).
  - On JWT-expired: same signOut path as `loadProjects`.
- Pass `onDeleteProject={handleDeleteProject}` to `<RebarForgeDashboard>`.

### 2. `src/components/dashboard/RebarForgeDashboard.tsx`
- Extend props: `onDeleteProject: (id: string) => void`.
- Forward to `<ProjectCard ... onDelete={() => onDeleteProject(p.id)} />`.
- In `ProjectCard`:
  - Add an absolutely-positioned **Trash2** icon button in the top-left of the preview area (mirrors the existing `IN PROGRESS` chip on the right).
  - Styling: small square button, `bg-background/80 hover:bg-destructive hover:text-destructive-foreground`, `opacity-0 group-hover:opacity-100 focus:opacity-100`.
  - `onClick`: `e.stopPropagation(); e.preventDefault(); onDelete();` so it doesn't trigger the card's navigation.
  - Add `aria-label="Delete project"` and `title="Delete project"`.
  - Import `Trash2` from `lucide-react`.

## Out of scope
- Server-side cascade: cascading deletes (segments, files, estimate_items, storage objects) are already covered by existing DB FKs / project-deletion flows in `AppSidebar.tsx` and `ProjectSettingsTab.tsx`. We reuse the same `from("projects").delete()` call, no new edge function.
- No new confirmation modal component — `window.confirm` matches existing patterns in this file (duplicate-project prompt).
- No bulk-delete, no soft-delete, no undo.
- No design-token changes; uses existing `destructive` semantic colors.

## Verification
- Hover a project card → trash icon fades in.
- Click trash → native confirm → card disappears from list, toast "Project deleted".
- Clicking elsewhere on the card still navigates to the project.
- `bunx tsc --noEmit` passes.
