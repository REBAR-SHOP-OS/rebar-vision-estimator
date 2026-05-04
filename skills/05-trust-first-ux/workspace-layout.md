# Trust-First Workspace Layout

3-pane industrial-SaaS layout:

```text
┌─────────────┬───────────────────────────────────┬───────────────┐
│  Project    │  StatusBanner                     │   Evidence    │
│  Sidebar    ├───────────────────────────────────┤   Drawer      │
│             │  Summary cards (Trusted/Pending)  │               │
│  Files      ├───────────────────────────────────┤   Source      │
│  Versions   │  EstimateGrid                     │   page +      │
│             │   - Approved / Review / Blocked   │   bbox        │
│             │   - Click row → load evidence     │   Approve /   │
│             │                                   │   Block /     │
│             │                                   │   Clarify     │
└─────────────┴───────────────────────────────────┴───────────────┘
```

Use `react-resizable-panels` for the splits. Default sizes: 18/55/27.

## Status states

- **Approved** — green. Counted in trusted total.
- **Review** — amber. Counted in pending total. Pricing locked.
- **Blocked** — red. Hard stop. Drawing generation locked.

## Rules

- Pricing allowed only when `blockedCount === 0 && needsReviewCount === 0`.
- Drawing generation gates on the same condition.
- Never invent values — empty cells render as `—`, never `0`.
- Every row carries `sourceSheets` so the Evidence drawer can deep-link.