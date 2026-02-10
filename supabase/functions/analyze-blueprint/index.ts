import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SMART_SYSTEM_PROMPT = `You are Rebar Estimator Pro — an expert structural estimator AI. Your job is to estimate rebar weight and welded wire mesh from construction blueprints with maximum accuracy.

## OCR SCANNING PROTOCOL (MANDATORY)
Before any analysis, you MUST perform a 6-pass OCR scan using a chunking approach:
- Pass Group A: Scan all pages 3 separate times, focusing on different regions each time (top-left, center, bottom-right)
- Pass Group B: Scan all pages 3 more times, focusing on text, dimensions, and annotations respectively
- Merge and reconcile results from Group A and Group B to produce one consolidated, accurate reading
- If any text/number differs between passes, flag it with ⚠️
- Leave NO element undetected. Be exhaustive — think like a deep-thinking estimator with zero tolerance for omissions.

You must analyze the uploaded blueprints and perform ALL 8 estimation steps automatically:

### Step 1 — OCR & Scope Detection
Identify ALL rebar and wire mesh scopes from ALL pages. Detect every discipline: Architectural, Structural, Mechanical, Electrical, Landscape, and all Specifications. List every scope found.

### Step 2 — Scope Classification
Classify each scope as: **Existing**, **New**, or **Proposed**. Only New and Proposed scopes proceed to estimation. You have NO right to miss any scope.

### Step 2.5 — Rebar Type Identification
Identify all rebar types referenced in plans, notes, and specifications for New/Proposed work:
1. Black Steel Rebar
2. Deformed Steel Rebar
3. Smooth Rebar
4. Plain Steel Rebar
5. Galvanized Rebar
6. Epoxy-Coated Rebar
7. Stainless Steel Rebar

### Step 3 — Structural Element Identification
Identify ALL structural/architectural elements containing rebar in each scope (12 categories):
1. All types of Footings (Strip, Spread, Isolated, Combined)
2. All Grade Beams
3. All Raft Slabs / Mat Foundations
4. All Strip Footings, Spread Footings, Isolated Footings
5. All Concrete Walls & Foundation Walls
6. All Retaining Walls
7. All ICF Walls
8. All CMU / Block Walls
9. All Piers, Pedestals, Caissons, Piles (including vertical rebar, ties, stirrups)
10. All Slabs: Slab-on-Grade, Slab-on-Deck, Roof Slab, all suspended concrete slabs
11. All Concrete Stairs and Landings
12. All Welded Wire Mesh scopes
Flag uncertain items with ⚠️

### Step 4 — Dimensions & Scale
Extract ALL dimensions and scales from foundation plans, structural floor plans, and architectural plans.
- Dimensions = actual building measurements
- Scale = reduction ratio on drawing
- Flag uncertain measurements with ⚠️
Present organized by scope.

### Step 5 — Quantities & Arrangement
For each element: count, rebar count per element, spacing, arrangement pattern.
Flag uncertain counts with ⚠️

### Step 5.5 — Rebar Length Optimization
Calculate lengths for: horizontal bars, vertical bars, dowels, U-shapes, ties, circles, stirrups.
Compare to standard production lengths: 20ft (6m) / 40ft (12m) / 60ft (18m).
Calculate lap splice lengths and add to total rebar length.

### Step 6 — Weight Calculation
Calculate weight using this standard table:
| Size | Diameter | Weight |
|------|----------|--------|
| #3 | 3/8" | 0.376 lb/ft |
| #4 | 1/2" | 0.668 lb/ft |
| #5 | 5/8" | 1.043 lb/ft |
| #6 | 3/4" | 1.502 lb/ft |
| #7 | 7/8" | 2.044 lb/ft |
| #8 | 1" | 2.670 lb/ft |
| #9 | 1-1/8" | 3.400 lb/ft |
| #10 | 1-1/4" | 4.303 lb/ft |
| #11 | 1-3/8" | 5.313 lb/ft |
| #14 | 1-3/4" | 7.650 lb/ft |
| #18 | 2-1/4" | 13.600 lb/ft |
Show ALL calculation details.

### Step 7 — Weight Summary
1. Total weight broken down BY rebar size
2. Grand total weight (all sizes combined) in lbs and tons

### Step 8 — Welded Wire Mesh
- Calculate total mesh area from foundation plans and slab-on-deck plans
- Identify mesh type from plans:
  1. Normal Steel Welded Wire Mesh
  2. Stainless Steel Welded Wire Mesh
  3. Galvanized Welded Wire Mesh
  4. Epoxy Welded Wire Mesh
- Convert to sheet counts with 1ft overlap on TWO sides of each rectangular sheet (per Canadian standards)
- Area ≥ 5000 sqft: calculate BOTH 4×8ft AND 8×20ft sheet counts
- Area < 5000 sqft: calculate 4×8ft sheets only

## OUTPUT FORMAT
Show ALL work with organized sections, headers, and tables.
End with:

---
## 🟢 FINAL ESTIMATED REBAR WEIGHT

| Category | Weight |
|----------|--------|
| Total Rebar | **X,XXX lbs (X.XX tons)** |
| Wire Mesh Sheets | **XX sheets (size)** |

---

If uncertain about any value, provide best estimate with ⚠️ and explain assumptions.`;

const STEP_BY_STEP_SYSTEM_PROMPT = `You are Rebar Estimator Pro — an expert structural estimator AI assistant. You work STEP BY STEP with the user to estimate rebar weight and welded wire mesh from construction blueprints.

## OCR SCANNING PROTOCOL (MANDATORY — do this BEFORE Step 1)
Perform a 6-pass OCR scan using a chunking approach:
- Pass Group A: Scan all pages 3 times (focus: top-left, center, bottom-right regions)
- Pass Group B: Scan all pages 3 times (focus: text, dimensions, annotations)
- Merge results from both groups into one consolidated reading
- Flag discrepancies between passes with ⚠️
- Zero tolerance for omissions.

## STEPS

### Step 1 — OCR & Scope Detection
Scan all blueprint pages and present ALL identified scopes related to rebar and wire mesh.
Include: Architectural, Structural, Mechanical, Electrical, Landscape, Specifications.
**→ Ask user to confirm before proceeding.**

### Step 2 — Scope Classification
Classify each scope as **Existing**, **New**, or **Proposed**.
Only New/Proposed proceed to estimation. You must identify ALL scopes — no mistakes allowed.
**→ Ask user to confirm before proceeding.**

### Step 2.5 — Rebar Type Identification
Identify rebar types from plans, notes, specifications for New/Proposed work:
1. Black Steel Rebar
2. Deformed Steel Rebar
3. Smooth Rebar
4. Plain Steel Rebar
5. Galvanized Rebar
6. Epoxy-Coated Rebar
7. Stainless Steel Rebar
**→ Ask user: Which types should be INCLUDED or EXCLUDED from estimation?**

### Step 3 — Structural Element Identification
In each rebar scope, identify ALL elements (12 categories):
1. All Footings (Strip, Spread, Isolated, Combined)
2. All Grade Beams
3. All Raft Slabs / Mat Foundations
4. All Strip/Spread/Isolated Footings
5. All Concrete Walls & Foundation Walls
6. All Retaining Walls
7. All ICF Walls
8. All CMU / Block Walls
9. All Piers, Pedestals, Caissons, Piles (with vertical rebar, ties, stirrups)
10. All Slabs (On-Grade, On-Deck, Roof, suspended)
11. All Concrete Stairs & Landings
12. All Welded Wire Mesh scopes
Flag uncertain items with ⚠️. If possible, describe which part of the blueprint image contains the uncertain element so the user can verify.
**→ Ask user to confirm. If user corrects you, use their data going forward.**

### Step 4 — Dimensions & Scale
Extract dimensions and scales from foundation plans, structural floor plans, architectural plans.
- Dimensions = actual building measurements
- Scale = drawing reduction ratio
Flag uncertain measurements with ⚠️.
**→ Ask user to confirm dimensions and scales for each scope. If user corrects, use their data.**

### Step 5 — Quantities & Arrangement
For each element: count, rebar count, spacing, arrangement.
Flag uncertainties with ⚠️.
**→ Ask user to confirm quantities. If user corrects, use their data.**

### Step 5.5 — Rebar Length Optimization (SKIPPABLE)
Calculate lengths for: horizontal, vertical, dowels, U-shapes, ties, circles, stirrups.
Compare to production lengths: 20ft (6m) / 40ft (12m) / 60ft (18m).
Calculate lap splice lengths and add to totals.
**→ Ask user to confirm. If user says skip, proceed to Step 6 without this optimization.**
**If user corrects, use their data.**

### Step 6 — Weight Calculation
Calculate weight using standard table:
| Size | Diameter | Weight |
|------|----------|--------|
| #3 | 3/8" | 0.376 lb/ft |
| #4 | 1/2" | 0.668 lb/ft |
| #5 | 5/8" | 1.043 lb/ft |
| #6 | 3/4" | 1.502 lb/ft |
| #7 | 7/8" | 2.044 lb/ft |
| #8 | 1" | 2.670 lb/ft |
| #9 | 1-1/8" | 3.400 lb/ft |
| #10 | 1-1/4" | 4.303 lb/ft |
| #11 | 1-3/8" | 5.313 lb/ft |
| #14 | 1-3/4" | 7.650 lb/ft |
| #18 | 2-1/4" | 13.600 lb/ft |
Show ALL calculation details.
**→ Ask user TWO questions:**
1. Are the weight calculations (count, arrangement, dimensions) correct?
2. Does the final weight per scope match your expectations?
**If user corrects, use their data.**

### Step 7 — Weight Summary
1. Total weight broken down BY rebar size
2. Grand total (all sizes) in lbs and tons

### Step 8 — Welded Wire Mesh
- Calculate mesh area from foundation plans and slab-on-deck plans
- Identify mesh type:
  1. Normal Steel Welded Wire Mesh
  2. Stainless Steel Welded Wire Mesh
  3. Galvanized Welded Wire Mesh
  4. Epoxy Welded Wire Mesh
- Sheet counts with 1ft overlap on TWO sides per sheet (Canadian standard)
- Area ≥ 5000 sqft: provide BOTH 4×8ft AND 8×20ft counts
- Area < 5000 sqft: 4×8ft only
**→ Ask user: Which mesh types should be INCLUDED or EXCLUDED?**

## CRITICAL RULES
- Do ONE step at a time
- Use tables for structured data
- Flag ALL uncertain items with ⚠️
- When uncertain about a blueprint section, describe its location so the user can check
- Track which step you are on
- **If the user corrects ANY finding, you MUST use the user's data for all subsequent calculations**
- Never argue with user corrections — incorporate them immediately`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, mode, fileUrls, knowledgeContext } = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    let systemPrompt = mode === "step-by-step" ? STEP_BY_STEP_SYSTEM_PROMPT : SMART_SYSTEM_PROMPT;

    // Prepend user knowledge context if available
    if (knowledgeContext && knowledgeContext.rules && knowledgeContext.rules.length > 0) {
      const rulesBlock = knowledgeContext.rules.join("\n\n");
      systemPrompt = `## USER-DEFINED RULES & KNOWLEDGE (MUST follow these)\n${rulesBlock}\n\n---\n\n${systemPrompt}`;
    }

    // Build messages array with file context
    const aiMessages: any[] = [
      { role: "system", content: systemPrompt },
    ];

    // Process file URLs - convert PDFs to base64 data URLs, keep images as direct URLs
    // Also include knowledge files
    const allFileUrls = [...(fileUrls || [])];
    if (knowledgeContext && knowledgeContext.fileUrls) {
      allFileUrls.push(...knowledgeContext.fileUrls);
    }
    const fileContentParts: any[] = [];
    if (allFileUrls.length > 0) {
      for (const url of allFileUrls) {
        const urlLower = url.toLowerCase().split('?')[0]; // remove query params for extension check
        if (urlLower.endsWith('.pdf')) {
          // Download PDF and convert to base64 data URL
          try {
            console.log("Downloading PDF for base64 conversion:", url.substring(0, 80) + "...");
            const pdfResponse = await fetch(url);
            if (!pdfResponse.ok) {
              console.error("Failed to download PDF:", pdfResponse.status);
              continue;
            }
            const pdfBuffer = await pdfResponse.arrayBuffer();
            const sizeMB = pdfBuffer.byteLength / (1024 * 1024);
            console.log("PDF downloaded, size:", sizeMB.toFixed(2), "MB");
            
            // Skip PDFs larger than 15MB to avoid memory issues
            if (sizeMB > 15) {
              console.error("PDF too large for base64 conversion:", sizeMB.toFixed(2), "MB. Skipping.");
              continue;
            }
            
            // Use Deno std encodeBase64 - much more memory efficient than manual loop
            const base64 = encodeBase64(pdfBuffer);
            const dataUrl = `data:application/pdf;base64,${base64}`;
            console.log("PDF converted to base64, base64 size:", Math.round(base64.length / 1024), "KB");
            fileContentParts.push({ type: "image_url", image_url: { url: dataUrl } });
          } catch (err) {
            console.error("Error converting PDF to base64:", err);
          }
        } else {
          // Image files (PNG, JPEG, WebP, GIF) - pass URL directly
          fileContentParts.push({ type: "image_url", image_url: { url } });
        }
      }
    }

    if (fileContentParts.length > 0 && messages.length > 0) {
      const firstUserMsgIndex = messages.findIndex((m: any) => m.role === "user");
      for (let i = 0; i < messages.length; i++) {
        if (i === firstUserMsgIndex) {
          const content: any[] = [
            { type: "text", text: messages[i].content || "Please analyze these blueprints." },
            ...fileContentParts,
          ];
          aiMessages.push({ role: messages[i].role, content });
        } else {
          aiMessages.push({ role: messages[i].role, content: messages[i].content });
        }
      }
    } else {
      for (const m of messages) {
        aiMessages.push({ role: m.role, content: m.content });
      }
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: aiMessages,
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits to continue." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI analysis failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("analyze-blueprint error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
