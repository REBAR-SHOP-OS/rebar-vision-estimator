

## Plan: Intelligent Learned Rules — Dedup, Merge, and Chat-Triggered Save

### Changes

**File: `supabase/functions/extract-learning/index.ts`** — rewrite lines 94-116

After extracting `learningText`, add smart dedup/merge:

1. **Fetch existing rules** for the user (`type: "learned"`)
2. **Second AI call** (upgraded to `gemini-2.5-flash`) that compares new learnings against existing ones and returns a JSON array of actions:
   - `skip` — semantically duplicate, do nothing
   - `merge` — refines an existing rule, return merged content + target ID → `UPDATE`
   - `insert` — truly novel → `INSERT`
3. **Execute** skip/merge/insert loop instead of blind insert
4. **Remove** the old cap-50-delete-oldest logic (dedup makes it unnecessary; keep a safety cap of 50 but only delete if inserts push past it)

**File: `supabase/functions/extract-learning/index.ts`** — accept optional `manualInsight` field

Add support for a `manualInsight` string in the request body. When present, skip the extraction AI call entirely and use `manualInsight` as the learning text, then run it through the same dedup/merge pipeline. This enables "Save to Brain" from chat.

**File: `src/components/chat/ChatArea.tsx`** — detect "save/remember" intent in user messages

Add a simple intent detector: if the user's message matches patterns like "save this", "remember this", "add to brain", "don't forget", "save to memory" — extract the assistant's last response and fire a call to `LEARN_URL` with `manualInsight` set to a summary of what the user wants saved. Show a toast confirming "Saved to Agent Brain".

### Dedup Prompt (inside edge function)

```
You have EXISTING learned rules and NEW learnings. For each new learning, decide:

EXISTING RULES:
[ID:uuid1] Always check general notes for lap splice info
[ID:uuid2] ...

NEW LEARNINGS:
1. Always verify lap splice lengths in general notes

Respond with ONLY a JSON array:
[{ "action": "skip|merge|insert", "target_id": "uuid (for merge)", "content": "final text (for merge/insert)", "reason": "brief" }]

Rules:
- "skip" if semantically identical (even different wording)
- "merge" if it refines/extends existing — combine into ONE stronger statement
- "insert" only if truly novel
- For critical corrections, use ALWAYS/NEVER language
- Strip any project-specific data (sheet numbers, dimensions, names)
```

### Files to Change
- `supabase/functions/extract-learning/index.ts` — dedup/merge logic + manual insight support (~50 lines net)
- `src/components/chat/ChatArea.tsx` — "save to brain" intent detection (~15 lines)

### Impact
- No more duplicate learned rules
- Related insights consolidated into stronger statements
- Users can explicitly say "remember this" or "save to brain" in chat
- Critical corrections reinforced with absolute language

