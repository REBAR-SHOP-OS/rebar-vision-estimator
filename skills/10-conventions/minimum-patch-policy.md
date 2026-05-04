# Minimum Patch Policy

Every change MUST be the smallest possible diff that solves the request.

- Only modify lines directly related to the request.
- Preserve working logic, UI, backend contracts, and structure.
- Prefer in-place edits over rewrites.
- Reuse existing helpers/components/hooks before adding new ones.
- Never refactor unrelated code.
- Never rename files/variables/routes/DB fields unless required.

Decision order: smallest patch → fewest files → least churn → preserve behavior → refactor only if asked.

Default modes: MINIMAL CHANGE · PATCH-FIRST · LOW TOKEN · PRODUCTION SAFE.