

## Plan: Enforce Brain Knowledge & Manual Usage for All Assumptions

### Problem
The AI sometimes makes assumptions without referencing the Agent Brain knowledge base or the Manual of Standard Practice PDF, even though both are uploaded and injected. The prompt needs stronger, more explicit directives.

### Changes (single file: `supabase/functions/analyze-blueprint/index.ts`)

#### 1. Add a "BRAIN KNOWLEDGE FILES" directive after the brain injection block (~line 1098)
Insert a new prompt section that explicitly tells the AI:
- The Agent Brain knowledge files (especially the Manual of Standard Practice) are **attached and available**
- For **every** assumption (Industry-Norm or otherwise), the AI **MUST** consult the brain files first
- If the Manual of Standard Practice is present, cite specific sections/pages from it
- If the Manual is NOT present, mark assumptions as `UNVERIFIED_ASSUMPTION!`
- Never make an assumption without checking the brain knowledge base first

#### 2. Strengthen CHM-3 (~line 487-492)
Add stronger language:
- "You MUST actively read and reference the Manual of Standard Practice PDF content for EVERY Industry-Norm assumption"
- "Do NOT skip reading the Manual — it is your primary source for standard practice"

#### 3. Add a brain file presence indicator in the prompt
After collecting `knowledgeContext.fileUrls`, inject a line like:
```
BRAIN FILES AVAILABLE: [Manual-Standard-Practice.pdf, IMG_9252.jpeg, ...] — YOU MUST CONSULT THESE FOR ALL ASSUMPTIONS.
```
This makes the AI explicitly aware the files are there and named.

### Scope
- 1 file modified (~15 lines added/changed)
- No database or frontend changes
- Strengthens existing behavior, no new features

