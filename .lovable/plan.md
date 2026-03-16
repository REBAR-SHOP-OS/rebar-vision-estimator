

# Embed the 5-Layer OCR Processing System into the Analysis Pipeline

## Current State vs. Your 5-Layer System

| Layer | Your Description | Current Implementation | Gap |
|-------|-----------------|----------------------|-----|
| **Layer 1**: Raw OCR Text | Extract all alphanumeric text (15M, @, o.c., TYP, EW, T&B) | Triple OCR via Google Vision (3 passes) | Covered — but the prompt doesn't instruct the AI to treat Layer 1 as a distinct "text-only" pass |
| **Layer 2**: Geometric/Linework | Classify solid heavy lines (concrete), dimension strings, dashed lines, polylines with hooks | Gemini sees images but has no explicit instruction to categorize line types | **Major gap** — no linework classification instructions |
| **Layer 3**: Spatial Association | Leader line tracking, b