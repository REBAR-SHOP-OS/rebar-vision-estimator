

## Enhance Agent Brain as Primary Instruction Source for 100% Accurate Calculations

### Current State
The system already injects Agent Brain knowledge into the AI prompt:
- **Rules** → prepended as `## USER-DEFINED RULES & KNOWLEDGE (MUST follow these)`
- **Files** → passed as image URLs alongside blueprints
- **Training Examples** → appended as `## TRAINING EXAMPLES — REFERENCE CALCULATIONS`
- **Learned Rules** → prepended as `## LEARNED FROM PREVIOUS CONVERSATIONS`

However, the current injection is weak — rules are treated as suggestions rather than overriding instructions, and training examples are appended at the end where they may be deprioritized by the model.

### Plan

**1. Elevate Agent Brain rules to HIGHEST priority in system prompt**
- Move user rules to the very TOP of the system prompt (before all other instructions)
- Wrap them with stronger enforcement language: `"ABSOLUTE RULES — These override ALL other instructions. Follow EXACTLY."`
- Add explicit instruction: `"If any built-in rule conflicts with a user-defined rule, the USER-DEFINED RULE WINS."`

**2. Elevate training examples priority**
- Move training examples from end-of-prompt to just after user rules (before the pipeline instructions)
- Strengthen wording: `"MANDATORY REFERENCE — Your calculations MUST match this methodology exactly. Any deviation is an error."`

**3. Add rule-enforcement verification step**
- Add a new Stage 0 to the pipeline: "**Stage 0 — Rule Compliance Check**: Before starting analysis, list ALL user-defined rules and confirm you will follow each one. If a rule specifies a calculation method, unit, format, or threshold — use it EXACTLY."

**4. Add post-calculation cross-check instruction**
- After Stage 9, add: "**Stage 10 — Rule Verification**: Re-check your output against ALL user-defined rules. If any calculation violates a rule, fix it before outputting."

### Files to Change
- `supabase/functions/analyze-blueprint/index.ts` (lines 988-1008): Restructure prompt assembly order and strengthen enforcement language

### Technical Detail
The system prompt assembly order will become:
```
1. Stage 0 — Rule Compliance preamble
2. USER-DEFINED RULES (ABSOLUTE — override everything)
3. TRAINING EXAMPLES (MANDATORY REFERENCE)
4. LEARNED RULES
5. PROJECT SCOPE DEFINITION
6. Standard system prompt (pipeline, schema, tables)
7. Stage 10 — Rule Verification appendix
```

