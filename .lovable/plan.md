

## Plan: Fix False Warning + "undefined tons" Display

### Problem 1: False "structured output not returned" warning
In step-by-step mode, when user sends "yes" or "proceed", the word "proceed" matches the `estimationIntent` regex, so `expectStructured` becomes `true`. But the AI responds conversationally (not with JSON), and the response doesn't match `aiIsAskingQuestion` either — so the warning fires incorrectly.

**Fix**: In `sendMessage` (line 1112-1115), for step-by-step mode, never expect structured output from follow-up messages. Structured output only comes from the initial `handleModeSelect` orchestration, not from conversational follow-ups. Change:
```typescript
const expectStructured = calculationMode === "smart" && estimationIntent && !aiIsAskingQuestion;
```

### Problem 2: "undefined tons" display
At line 1781, if `q.total_weight_tonnes` is `NaN` (e.g. from dividing undefined/1000), `??` does NOT catch `NaN` — it only catches `null`/`undefined`. So `NaN.toLocaleString()` → `"NaN"`. Similarly if the value is literally the string `"undefined"` from bad data.

**Fix**: Add numeric safety to the display values (lines 1779-1782):
```typescript
const totalLbs = Number(q.total_weight_lbs) || 0;
const totalKg = Number(q.total_weight_kg) || (totalLbs * 0.453592);
const rawTonnes = q.total_weight_tonnes ?? q.total_tonnes;
const totalTonnes = (typeof rawTonnes === 'number' && !isNaN(rawTonnes)) ? rawTonnes : (totalKg > 0 ? totalKg / 1000 : 0);
const rawTons = q.total_weight_tons;
const totalTons = (typeof rawTons === 'number' && !isNaN(rawTons)) ? rawTons : (totalLbs > 0 ? totalLbs / 2000 : 0);
```

### Scope
- 1 file: `src/components/chat/ChatArea.tsx`
- ~10 lines changed across 2 locations

