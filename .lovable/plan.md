

## Autonomous Estimation-to-Quote Pipeline

### What you're asking for

A full end-to-end automated workflow: pick a lead from the CRM pipeline, find/receive drawings, run estimation, create a comprehensive report explaining methodology, send to Ben for review, learn from his feedback, search past estimates for reference, get Ben's approval, create a formal quotation, send to Neel for approval, then send to customer and handle follow-ups.

### Current state

- CRM pipeline leads are fetched and displayed (working now per screenshot)
- Estimation pipeline exists (9-step Atomic Truth with AI analysis)
- Share for Review exists (sends link to external reviewer for comments)
- Learning system exists (extract-learning edge function)
- Export system exists (Excel + PDF reports)

### What needs to be built

**1. Lead-to-Project Auto-Creation**
When a user clicks a lead (e.g. "110 Mornelle Court"), automatically create a project linked to that lead and open it in the chat. Currently leads can only be "linked" to existing projects -- need a "Start Estimation" action that creates the project from the lead.

**2. Enhanced Review Report for Ben**
The current Share for Review page is bare -- just shows reviewer info and a comment box. It needs to include:
- Full bar list with element breakdown
- Size summary with weights
- Methodology explanation (how each element was detected, which pages, what OCR text was used)
- Scope definition and deviations
- Reference to similar past estimates (searched from `estimate_outcomes` + `agent_knowledge`)
- All stored as `review_data` JSON on the `review_shares` row so the public page can render it without auth

**3. Multi-Stage Approval Workflow**
Extend `review_shares` with a `review_type` field:
- `estimation_review` -- Ben reviews the estimation methodology and results
- `quote_approval` -- Neel approves the final quotation before sending to customer
- `customer_quote` -- The formal quote sent to the customer

Add a `review_shares.review_data` JSONB column to store the snapshot of estimation data, quote details, and methodology explanation.

**4. Approval Chain in ChatArea**
After estimation completes:
1. Auto-generate a methodology report
2. Send to Ben (ben@rebar.shop) for estimation review
3. When Ben comments/approves, show his feedback in chat
4. Search `agent_knowledge` and `estimate_outcomes` for similar past projects to refine
5. Generate formal quotation
6. Send to Neel (neel@rebar.shop) for quote approval
7. After Neel approves, generate customer-facing quote
8. Send to customer (from lead's customer email)

**5. Follow-up Tracking**
Add a `follow_ups` table to schedule and track follow-up actions (e.g., "Check if customer responded", "Send revised quote").

### Database Changes

```sql
-- Add review_data and review_type to review_shares
ALTER TABLE review_shares ADD COLUMN review_data jsonb DEFAULT '{}';
ALTER TABLE review_shares ADD COLUMN review_type text DEFAULT 'estimation_review';

-- Follow-ups table
CREATE TABLE follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  action text NOT NULL,
  due_date timestamptz,
  status text DEFAULT 'pending',
  notes text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own follow_ups" ON follow_ups FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

### Edge Function Changes

**`send-review-invite`** -- extend to accept `review_type` and `review_data` (estimation snapshot, methodology, quote data) and store them on the share row.

### Frontend Changes

1. **CrmSyncPanel** -- Add a "Start Estimation" button per lead that creates a project and opens it
2. **ReviewPage** -- Render the full estimation report (bar list, size breakdown, methodology) from `review_data`, not just a blank comment form
3. **ChatArea** -- After estimation completes, add an "approval workflow" flow:
   - "Send to Ben for Review" button that auto-populates ben@rebar.shop
   - Poll/subscribe for comments on the share
   - Show Ben's comments inline
   - "Generate Quote & Send to Neel" button
   - "Send to Customer" button after Neel approves
4. **ShareReviewDialog** -- Pre-fill with ben@rebar.shop / neel@rebar.shop based on review type

### Implementation Order

1. Database migration (add columns + follow_ups table)
2. Update `send-review-invite` to handle review_data and review_type
3. Update CrmSyncPanel with "Start Estimation" action
4. Enhance ReviewPage to render full estimation report from review_data
5. Add approval workflow buttons and comment polling to ChatArea
6. Add follow-up tracking UI

