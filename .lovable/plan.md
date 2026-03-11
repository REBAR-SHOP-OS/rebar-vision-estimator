

## Root Cause Analysis: Why the AI Used Data from a Different Project

### The Three Contamination Vectors

After tracing the full pipeline, I found **three mechanisms** that allow data from one project to leak into another:

```text
┌─────────────────────────────────────────────────────────┐
│  CONTAMINATION VECTOR 1: LEARNED RULES (CRITICAL)       │
│                                                          │
│  extract-learning/index.ts stores "learnings" from       │
│  conversations into agent_knowledge table.               │
│                                                          │
│  Problem: Learnings can contain PROJECT-SPECIFIC DATA    │
│  like "The retaining wall on S-2 is 74m long" or         │
│  "Sheet S-5 has the pile schedule".                       │
│                                                          │
│  These are injected into EVERY future project via:        │
│  fetchKnowledgeContext() → learnedRules[] → system prompt │
│                                                          │
│  The AI then references "S-2", "S-5", "S-7" from a      │
│  PREVIOUS project's learned rules, not the current one.  │
├─────────────────────────────────────────────────────────┤
│  CONTAMINATION VECTOR 2: TRAINING EXAMPLES               │
│                                                          │
│  agent_training_examples table has NO project_id filter.  │
│  fetchKnowledgeContext() loads ALL training examples      │
│  regardless of project. If a training example contains   │
│  project-specific sheet refs (S-2, S-5), the AI treats   │
│  them as applicable to the CURRENT project.              │
├─────────────────────────────────────────────────────────┤
│  CONTAMINATION VECTOR 3: AGENT KNOWLEDGE (RULES/FILES)   │
│                                                          │
│  agent_knowledge query at line 254 has NO filter at all:  │
│    .from("agent_knowledge").select("*")                  │
│  No user_id filter, no project_id filter.                │
│  ALL knowledge items from ALL users load into prompt.    │
└─────────────────────────────────────────────────────────┘
```

### Why the AI Referenced "S-2, S-5, S-7" on a "Caithness" Project

The `extract-learning` edge function (line 31-43) extracts learnings from conversations and stores them as `type: "learned"` in `agent_knowledge`. These learnings often contain **project-specific details** like sheet numbers, dimensions, and element names from previous projects.

When the Caithness project ran, `fetchKnowledgeContext()` loaded ALL learned rules (no project filter), and the system prompt injected them as:
```
## LEARNED FROM PREVIOUS CONVERSATIONS (Apply these insights)
```

The AI saw sheet references from a prior project and incorrectly applied them.

### Proposed Fixes

**Fix 1: Filter `agent_knowledge` by `user_id`** (ChatArea.tsx, line 254)
- Currently: `.select("*")` — loads ALL knowledge from ALL users
- Fix: `.select("*").eq("user_id", user.id)` — only the current user's knowledge

**Fix 2: Sanitize learned rules to strip project-specific data** (extract-learning/index.ts)
- Add instruction to the extraction prompt: "Do NOT include project-specific sheet numbers, element IDs, dimensions, or project names. Extract ONLY generalizable methodology insights."
- Add a filter pattern that strips sheet references like "S-2", "page 3", specific dimensions

**Fix 3: Add project isolation directive to system prompt** (analyze-blueprint/index.ts)
- Add an explicit instruction near the top of the system prompt:
```
CRITICAL DATA ISOLATION RULE: You are analyzing ONLY the documents provided in THIS conversation. 
ANY sheet numbers, element IDs, dimensions, or project details mentioned in "Learned Rules" or 
"Training Examples" are from DIFFERENT projects and MUST NOT be referenced as evidence for this project.
Use learned rules ONLY for methodology/approach — NEVER for specific data points.
```

**Fix 4: Label learned rules with source project context** (extract-learning/index.ts)
- When storing a learned rule, prefix it with: `[Methodology only — from a previous project]:`
- This makes the AI aware the data is from elsewhere

### Files to Change
- `src/components/chat/ChatArea.tsx` — add `user_id` filter to knowledge query (1 line)
- `supabase/functions/extract-learning/index.ts` — sanitize extraction prompt (~5 lines)
- `supabase/functions/analyze-blueprint/index.ts` — add data isolation directive (~5 lines)

### Impact
These fixes prevent the AI from ever using project-specific data from previous projects. The learned rules system remains functional but only carries forward **methodology** insights, not raw data points.

