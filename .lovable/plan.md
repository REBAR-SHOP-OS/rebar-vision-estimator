

## Plan: Improve expired session handling

The root cause is that the JWT expired and `autoRefreshToken` failed to renew it silently. The app should detect 401/JWT-expired responses and force a re-login instead of showing a generic "Failed to load projects" error.

### Change

**File: `src/contexts/AuthContext.tsx`** — Add a listener in the `onAuthStateChange` handler for `TOKEN_REFRESHED` failure and `SIGNED_OUT` events. When a `SIGNED_OUT` event fires (which happens when refresh fails), clear state and the user sees the login page automatically.

Additionally, add a global response interceptor or a wrapper around Supabase calls in `src/pages/Dashboard.tsx` that catches 401 errors and calls `signOut()` to force redirect to login, showing a toast: "Session expired. Please sign in again."

### Specific edit in `Dashboard.tsx`

In `loadProjects()`, check if the error message contains "JWT expired" and if so, call `signOut()` with a toast notification instead of showing "Failed to load projects".

Similarly in `handleNewProjectFileSelect()`, check for JWT expired before showing "Failed to create project".

### Scope
- 1 file modified: `src/pages/Dashboard.tsx` (add JWT expired detection to existing error handlers)
- No new dependencies, no backend changes

