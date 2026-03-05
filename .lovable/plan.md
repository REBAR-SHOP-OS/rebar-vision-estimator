

## Plan: Notification System for Approval Workflow

### What needs to happen

1. **New edge function: `notify-reviewer`** -- Sends email and SMS notifications to Ben and Neel when a review is shared with them, and notifies the project owner (Neel as salesperson) when a reviewer leaves a comment.

2. **Email notifications** via Lovable AI (no external email service needed for transactional notifications -- we'll use an edge function that calls a simple email-sending approach via the Supabase auth hook pattern, OR more practically, we'll integrate with the existing `send-review-invite` edge function to also trigger a notification).

   Since Lovable doesn't support arbitrary email sending natively, we'll use the **Resend** connector or a simple webhook-based approach. However, to keep it self-contained, the most practical approach is:
   - Enhance `send-review-invite` to compose and log a notification record
   - Create a `notifications` table to track all sent notifications
   - Create a `notify-reviewer` edge function that sends email via Resend (requires API key)

3. **Realtime comment polling** -- Already implemented (10s interval). Enhance to also trigger a notification to the project owner when a new comment arrives.

### Do we need an external service?

Email and SMS require external services. Let me check available connectors and secrets.

### Implementation

#### 1. Database: `notifications` table
```sql
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  recipient_email text NOT NULL,
  recipient_name text,
  notification_type text NOT NULL, -- 'review_invite', 'comment_received', 'approval_request'
  channel text NOT NULL DEFAULT 'email', -- 'email', 'sms', 'in_app'
  subject text,
  body text,
  status text DEFAULT 'pending', -- 'pending', 'sent', 'failed'
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages notifications" ON notifications FOR ALL USING (true);
```

#### 2. Edge function: `notify-reviewer`
- Accepts: `recipient_email`, `recipient_name`, `notification_type`, `subject`, `body`, `share_url`
- Sends email via Resend API (need `RESEND_API_KEY` secret)
- Optionally sends SMS via Twilio (need `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` secrets) -- or we can start with email-only and add SMS later
- Logs to `notifications` table

#### 3. Update `send-review-invite` 
- After creating the share, call `notify-reviewer` internally to email Ben/Neel with:
  - The share link
  - A summary of what they're reviewing (estimation vs quote)
  - Key numbers (total weight, element count)

#### 4. Update `ReviewPage.tsx` comment submission
- After a comment is submitted, call a new endpoint to notify the project owner (Neel) that a comment was received

#### 5. Frontend: ApprovalWorkflow enhancements
- Already has pre-filled emails (ben@rebar.shop, neel@rebar.shop) and comment polling -- these are working
- Add a "Notification sent" indicator after each stage transition
- Add Neel's phone number for SMS notifications (hardcoded or from profile)

### Secret needed
- **RESEND_API_KEY** -- for sending transactional emails. User will need to provide this.
- SMS (Twilio) can be added as a follow-up if desired.

### Files to create/modify
1. **Create** `supabase/functions/notify-reviewer/index.ts` -- email notification sender
2. **Migrate** -- add `notifications` table
3. **Edit** `supabase/functions/send-review-invite/index.ts` -- call notify-reviewer after creating share
4. **Edit** `src/pages/ReviewPage.tsx` -- trigger owner notification on comment submit
5. **Edit** `src/components/chat/ApprovalWorkflow.tsx` -- show notification status badges
6. **Edit** `supabase/config.toml` -- register new function

