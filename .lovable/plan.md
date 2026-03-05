

## Plan: Make All Brain Rules Editable by Any Authenticated User

### Problem
The edit button only appears for rules where `isOwner` is true (i.e., the current user created it). Since the Brain is now shared globally, rules created by other users (like "instruction main") cannot be edited by the current user.

### Changes

**1. Update `EditableRuleCard` in `BrainKnowledgeDialog.tsx`**
- Show the edit (Pencil) button for all authenticated users, not just the owner
- Keep delete restricted to owner only (to prevent accidental deletion of others' rules)

**2. Update RLS policy on `agent_knowledge`**
- Replace the owner-only UPDATE policy with one that allows any authenticated user to update any row

### Database Migration
```sql
DROP POLICY IF EXISTS "Users can update their own knowledge" ON public.agent_knowledge;
CREATE POLICY "Authenticated users can update knowledge"
ON public.agent_knowledge FOR UPDATE TO authenticated
USING (true) WITH CHECK (true);
```

### UI Change
Line 661-669: Split edit and delete visibility -- edit shown to all, delete only to owner.

