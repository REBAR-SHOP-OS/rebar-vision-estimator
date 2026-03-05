

## Plan: Make Agent Brain Shared Across All Users

### Problem
Currently, all queries to `agent_knowledge` and `agent_training_examples` filter by `user_id`, meaning each user only sees their own rules, files, training examples, and learned items. The user wants the Brain to be shared — all users should see and benefit from the same knowledge base.

### Changes

**1. Remove `user_id` filter from queries in `BrainKnowledgeDialog.tsx`**
- `loadItems()`: Remove `.eq("user_id", user!.id)` so all knowledge items are loaded
- `loadTrainingExamples()`: Remove `.eq("user_id", user!.id)` so all training examples are loaded
- Inserts still use the current `user_id` (to track who created it), but reads are global

**2. Remove `user_id` filter from `fetchKnowledgeContext()` in `ChatArea.tsx`**
- Line 171: Remove `.eq("user_id", user.id)` from `agent_knowledge` query
- Line 196: Remove `.eq("user_id", user.id)` from `agent_training_examples` query

**3. Update RLS policies on both tables** (database migration)
- `agent_knowledge`: Add a SELECT policy allowing all authenticated users to read all rows
- `agent_training_examples`: Add a SELECT policy allowing all authenticated users to read all rows
- Keep existing INSERT/DELETE policies scoped to `user_id` (only the creator can add/remove)

**4. Update `extract-learning/index.ts`**
- Remove `user_id` filter from the count check so learned items are managed globally (or keep per-user cleanup — will keep per-user to avoid one user deleting another's learnings)

### RLS Migration SQL
```sql
-- Allow all authenticated users to read all knowledge
DROP POLICY IF EXISTS "Users can view their own knowledge" ON public.agent_knowledge;
CREATE POLICY "All authenticated users can view knowledge"
ON public.agent_knowledge FOR SELECT TO authenticated
USING (true);

-- Allow all authenticated users to read all training examples  
DROP POLICY IF EXISTS "Users can view their own training examples" ON public.agent_training_examples;
CREATE POLICY "All authenticated users can view training examples"
ON public.agent_training_examples FOR SELECT TO authenticated
USING (true);
```

### Summary
- **Reads** become global (all users see all brain content)
- **Writes/Deletes** stay per-user (only the creator can add or remove their entries)
- The analysis prompt will include knowledge from all users

