## Goal

PR #7 is 10 ahead / 666 behind `main` and GitHub marks it `mergeable: false` with branch status `diverged`. Per your decision, we will diagnose the drift and then **replace PR #7** with a fresh, clean equivalent PR rebuilt on top of current `main`.

## Diagnosis (what's actually wrong)

- The local Lovable working branch is already in sync with `origin/main` (HEAD = `448002a`, same commit as `origin/main`). So **PR #7's branch only exists on GitHub**, not in the Lovable workspace.
- "10 ahead / 666 behind" means PR #7 was opened from a snapshot of `main` taken ~666 commits ago. GitHub will not auto-merge because:
  1. The merge base is far in the past.
  2. Many of those 666 commits almost certainly touch the same files PR #7's 10 commits touch (lint config, CI workflow, vitest config, ChatArea, verified-estimate, workflow-v2 stages — all of which we've modified again recently).
- Trying to "Update branch" from the GitHub UI will produce a large, hand-conflicted merge that is risky and noisy. Replacement is safer and cleaner.

## Strategy: replace PR #7 with a fresh PR

We do **not** rewrite or force-push the old branch. We build a new branch from current `main`, port over only the *intent* of PR #7's 10 commits, push, open a new PR, then close PR #7 with a pointer to the replacement.

## Steps

1. **Inventory PR #7's 10 commits**
   - Use the GitHub API (read-only) to list the 10 commits on PR #7 and the union of files they changed. This gives us the exact "intent" payload we need to re-apply.
   - Classify each commit as one of:
     - (a) already present on `main` (skip),
     - (b) still relevant and cleanly portable (re-apply),
     - (c) obsolete or superseded by newer `main` work (drop, with note in PR description).

2. **Create a fresh branch from current `main`**
   - Branch name: `fix/pr7-replacement` off `origin/main` (`448002a`).
   - This branch starts mergeable by definition (0 behind).

3. **Re-apply the still-relevant changes as small patches**
   - For each (b) commit, apply the minimum diff needed against today's `main`. We do **not** `git cherry-pick` blindly — many hunks will not match after 666 commits. We re-author the change as a minimal patch using current file contents, preserving the original commit's intent and message.
   - Honor project rules: minimum patch policy, no unrelated refactors, no rename churn, semantic tokens only, no edits to `src/integrations/supabase/{client,types}.ts`.

4. **Validate locally before pushing**
   - `bun install --frozen-lockfile`
   - `bun run lint` (must exit 0 — CI now uses no `--max-warnings` cap, but we still want a clean run)
   - `bun run test`
   - `bun run build`
   - `bun run check:bundle-size`
   - Only push if all four pass.

5. **Open the replacement PR**
   - Title: same as PR #7, suffixed with `(rebuilt on main)`.
   - Body: link to PR #7, list which of the 10 original commits were ported, which were dropped as obsolete, and why.
   - Target: `main`. Expect `mergeable: true`, `ahead_by: N`, `behind_by: 0`.

6. **Close PR #7**
   - Add a comment on PR #7 pointing to the new PR, then close (do not delete the branch immediately — keep it for 1 week as a safety reference).

## Guardrails

- No force-push to any shared branch.
- No edits to `src/integrations/supabase/client.ts`, `src/integrations/supabase/types.ts`, `.env`, or files under `supabase/migrations/`.
- If a ported change conflicts semantically with newer `main` behavior, we **stop and ask** rather than guess.
- Old PR #7 branch is preserved on GitHub until the replacement PR is merged and verified.

## Prerequisite I need from you before executing

I cannot reach `api.github.com` for `REBAR-SHOP-OS/rebar-vision-estimator` without a token in this sandbox. To execute step 1 deterministically I need **one** of:

- a fine-grained GitHub PAT with `pull_requests: read` + `contents: read` on this repo (stored via the secrets tool as `GITHUB_TOKEN`), **or**
- you paste the output of: PR #7 → "Files changed" tab → "..." → "View file" for each of the 10 commits (or just the commit SHAs and I'll fetch via `curl` once the token is set).

Once I have either, I'll execute steps 2–6 in build mode.
