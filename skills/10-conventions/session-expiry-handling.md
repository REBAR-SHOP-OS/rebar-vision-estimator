# Session Expiry Handling

During long-running loops (PDF rendering, batch uploads, multi-page Vision
analysis) the JWT can expire mid-flight. Two rules:

## 1. Refresh proactively before heavy loops

```ts
const { data: { session }, error } = await supabase.auth.refreshSession();
if (error || !session?.user) throw new Error("Not authenticated");
const userId = session.user.id;
// ... loop using userId
```

## 2. React to JWT errors anywhere

Wrap the supabase client (or use a global error boundary) — when you see
`PGRST301` / `JWT expired` / 401:

- Call `supabase.auth.signOut()`.
- Toast: "Session expired — please sign in again".
- Redirect to `/auth`.

Never silently retry — the user needs to know they were logged out.