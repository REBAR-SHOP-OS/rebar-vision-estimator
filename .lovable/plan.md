

## Plan: Fix Storage RLS Path in pdf-to-images.ts

### Problem
`pdf-to-images.ts` uploads to `${projectId}/pages/...` but the `blueprints` bucket RLS policy requires the first folder segment to be `auth.uid()`. Every upload returns 403.

### Fix

**1. Update `src/lib/pdf-to-images.ts`** (lines ~68-69)

- Before the upload loop, call `supabase.auth.getUser()` to get the current user ID
- Change the storage path from:
  ```
  ${projectId}/pages/${timestamp}_page_${pageNum}.png
  ```
  to:
  ```
  ${userId}/${projectId}/pages/${timestamp}_page_${pageNum}.png
  ```

This is a ~5-line change in one file. No other files need modification since `ChatArea.tsx` already calls the function correctly.

