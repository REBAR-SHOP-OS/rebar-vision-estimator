# Audit Logging

Every meaningful workflow action writes one row to `public.audit_events`
(see `00-architecture/data-model.sql`).

## Standard action names

| Action | When |
|---|---|
| `project.created` | New project row |
| `file.uploaded` | After successful storage write |
| `extraction.started` | Edge function invoked |
| `extraction.completed` | Atomic Truth JSON saved |
| `element.approved` | User clicks Approve |
| `element.blocked` | User clicks Block |
| `export.ai_candidate` | AI sketch PDF rendered |
| `export.review_draft` | Review draft PDF rendered |
| `export.issued` | Issued drawing PDF rendered (only after gates) |

## Helper

```ts
export async function audit(action: string, projectId: string, payload: object = {}) {
  await supabase.from("audit_events").insert({ action, project_id: projectId, payload });
}
```

RLS auto-binds `user_id` via the policy default — no need to pass it.