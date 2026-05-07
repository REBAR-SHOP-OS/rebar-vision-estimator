## Patch — show extracted hints on Partial rows (no zeros, no inventions)

**File:** `src/features/workflow-v2/stages/TakeoffStage.tsx`

Change in 4 spots: treat `geometry_status === "partial"` the same as `"unresolved"` for value display only. The `Partial` orange badge, tooltip, missing_refs chips, and DB values stay exactly as-is.

### Edits

**1. Qty cell (~line 486)**
```tsx
) : r.geometry_status !== "resolved" ? <UnresolvedValue value={foundDisplay.qty} /> : r.count}
```

**2. Length cell (~line 492)**
```tsx
) : r.geometry_status !== "resolved" ? <UnresolvedValue value={foundDisplay.length} /> : r.length.toFixed(2)}
```

**3. Weight cell (~line 498)**
```tsx
) : r.geometry_status !== "resolved" ? <UnresolvedValue value={foundDisplay.weight} /> : r.weight.toFixed(1)}
```

**4. Right pane Field block (~lines 593-605)** — change the ternary from `=== "unresolved"` to `!== "resolved"` and reuse `extractFoundDisplay(sel)` for partial rows too. Also render the `UnresolvedFoundPanel` when `!== "resolved"` (line 589).

### Result for the 8 rows currently at 0/0/0

| Row | Was | Will show (extracted from OCR) |
|---|---|---|
| 152mm FROST SLAB W/ 15M @ 305 EW | 0/0.00/0.0 | bar 15M; thickness 152mm; spacing 305mm O.C.; each way → Need run / 152mm / Need run |
| C10M @750 ALONG PAD EDGE (HKP>1500x1500) | 0/0.00/0.0 | bar 10M; spacing 750mm O.C. → Ask / Ask / Need run |
| 4-C10M IN CORNERS (HKP) | 0/0.00/0.0 | qty=4; bar 10M → 4 / Ask / Need run |
| 203mm FW W/ 15M @ 406 MEW | 0/0.00/0.0 | bar 15M; thickness 203mm; spacing 406mm O.C.; each way → Need run / 203mm / Need run |
| (2) 20M door openings | 0/0.00/0.0 | bar 20M → Ask / Ask / Need run |
| 15M @ 406 STAGGERED | 0/0.00/0.0 | bar 15M; spacing 406mm O.C.; staggered → Need run / Ask / Need run |
| 15M x 457 @ 610 STAGGERED | 0/0.00/0.0 | bar 15M; piece length 0.457m; spacing 610mm O.C. → Need run / 0.457m ea / Need run |
| 400mm 10M dowels @ 300 | 0/0.00/0.0 | bar 10M; piece length 0.400m; spacing 300mm O.C. → Need run / 0.400m ea / Need run |

No row shows `0` after the patch — every cell shows either the parsed value or the honest token `Need run` / `Ask`. Confirm Takeoff Data button still routes to QA, where each missing dimension can be filled.

### Out of scope
- Parser improvement to extract element dimensions (real follow-up).
- Verifying the 3 already-`answered` validation_issues actually wrote back to `estimate_items` — separate audit task.

### Files touched
- `src/features/workflow-v2/stages/TakeoffStage.tsx` (~6 lines, UI only).
