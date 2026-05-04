# Shop-Drawing AI Prompt Skeleton

Use for generating an **AI Candidate** sketch — explicitly NOT a fabrication-ready drawing.

```text
Produce an UNVERIFIED AI CANDIDATE SKETCH. Schematic only. NOT a fabrication-ready drawing.

LAYOUT (white background, landscape sheet, fill the page):
• Main drawing area (left ~80%): {plan|elevation|section} view of {element}.
• Right ~20%: small LEGEND box only.
• DO NOT draw a title block, drawing number, scale field, or revision cell.
  The host application adds an "AI CANDIDATE" header outside the image.

CONTENT:
• Approximate dimensions only. Round numbers. Never imply final accuracy.
• Generic part labels ({M1}, {M2}). DO NOT include quantity/length triplets.
• For change callouts: dashed orange balloon labelled "Candidate #1" (incrementing).
• DO NOT write "REV", "R0", "DETAILER", "CHECKER", "ISSUED FOR CONSTRUCTION",
  or any title-block field.

STYLE — non-negotiable:
• Loose CAD-like linework. Clearly a draft.
• No photo-realism, no shading, no colour beyond hatching.
```

The AI Candidate is a *review artifact*, never a deliverable. Issued exports
go through `06-shop-drawing-engine/sheet-templates/issued.html.ts` instead.