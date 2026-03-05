

## Feature: Share Estimation for Review & Comments

After an estimation is complete, add the ability to share it with external reviewers (e.g., ben@rebar.shop) who can view the results and leave comments -- all tracked within the project chat.

### Database Changes

**New table: `review_shares`**
- `id` (uuid, PK)
- `project_id` (uuid, FK to projects)
- `user_id` (uuid, owner)
- `reviewer_email` (text, e.g. ben@rebar.shop)
- `reviewer_name` (text, nullable)
- `share_token` (text, unique, for public access link)
- `status` (text: pending / viewed / commented)
- `created_at`, `expires_at`
- RLS: owner can CRUD, anon can SELECT by share_token

**New table: `review_comments`**
- `id` (uuid, PK)
- `share_id` (uuid, FK to review_shares)
- `author_name` (text)
- `author_email` (text)
- `content` (text)
- `created_at`
- RLS: anon can INSERT (by valid share_token), owner can SELECT all for their shares

### Edge Function: `send-review-invite`
- Accepts `project_id`, `reviewer_email`, `reviewer_name`
- Creates a `review_shares` row with a random `share_token`
- Sends an email via Supabase Auth's built-in email or a simple SMTP call with a link like: `https://rebar-vision-estimator.lovable.app/review/{share_token}`
- Returns the share link

### New Pages & Components

1. **`/review/:token` page** (public, no auth required)
   - Fetches project estimation data via share_token
   - Shows read-only view: bar list, size breakdown, totals, scope info
   - Comment form at the bottom (name, email, comment text)
   - Comments are saved to `review_comments`

2. **Share button in `ExportButtons`**
   - New "Share for Review" button alongside Export Excel / PDF
   - Opens a small dialog: enter reviewer email + name, click Send
   - Calls the `send-review-invite` edge function
   - Shows the shareable link with a copy button

3. **Comments indicator in `ChatArea`**
   - When a share exists, show a badge/notification if new comments arrive
   - Display review comments inline in the chat as system messages

### Implementation Order
1. Create database tables (`review_shares`, `review_comments`) with RLS
2. Build the `send-review-invite` edge function
3. Add the Share dialog to `ExportButtons`
4. Create the `/review/:token` public page with read-only estimation view + comment form
5. Show incoming comments in the project chat

