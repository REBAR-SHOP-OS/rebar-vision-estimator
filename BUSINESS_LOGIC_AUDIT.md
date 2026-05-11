# Business Logic Audit Report: Rebar Estimator Pro

## 1. Domain Standards & Methodology
- **RSIC/CSA Compliance:** The system strictly adheres to Canadian rebar standards (CSA G30.18). Mass constants (e.g., 10M = 0.785 kg/m) are accurate and used as the single source of truth for calculations.
- **6-Phase Takeoff:** The methodology (Specs -> Foundation -> Verticals -> Flatwork -> Hidden -> Convert) is deeply integrated into both the deterministic resolvers and AI prompts, ensuring a systematic approach to estimation.
- **Golden Rules:**
    - **G1 (Starter Bar):** Correctly enforces `floor(L/spacing) + 1`.
    - **G2 (Written vs Scaled):** Logic prioritizes OCR-extracted written dimensions over scale-calculated ones.
    - **G3 (Clear Cover):** Implements default 75mm cover for earth-face unless overridden.
    - **G4 (Waste Factor):** Applies a tiered waste factor (3%, 5%, 8%) plus a configurable global default (7%).

## 2. Calculation Integrity
- **Unit Conversions:** The conversion factor `1 lb/ft = 1.48816 kg/m` is applied consistently across the application and tests.
- **Geometry Resolution:** The "Geometry Resolver" in `auto-estimate` correctly handles complex shapes (L, U, Z) and applies RSIC standard hook additions (90°, 135°, 180°).
- **WWM/Mesh:** Logic correctly calculates weight based on area (`mass/m2 * area`) rather than linear run, following industry best practices.

## 3. AI Logic Compliance
- **Source Priority:** Gemini prompts successfully enforce the hierarchy: Shop Drawings (Primary) > Structural (Secondary) > Architectural (Context Only).
- **Hallucination Prevention:** The use of "Golden Rules" and "Project-Type Playbooks" effectively constrains AI output to realistic structural elements.
- **Traceability:** The system mandates citations for any assumptions (e.g., citing the Manual of Standard Practice 2018), which is critical for professional accountability.

## 4. CRM & Financial Accuracy
- **Revenue Mapping:** Quote `quoted_price` correctly maps to Odoo lead `expected_revenue`.
- **Outcome Analysis:** Delta calculations for won/lost projects accurately identify estimation biases (under/over-estimating) using Median Absolute Deviation (MAD).
- **Currency Handling:** Consistent use of CAD as the primary currency, with infrastructure in place for multi-currency support.

## 5. Identified Risks & Recommendations
- **Logic Duplication:** Rebar weight tables and calculation logic are duplicated between `src/lib` and `supabase/functions`. This is a high-risk area for logic drift.
- **Assumption Enforcement:** While prompts mandate citations, the deterministic resolver could benefit from stricter validation that a citation actually exists before allowing a row to be marked "Resolved".
- **Rounding Consistency:** Small discrepancies in rounding (2 vs 3 decimal places) were noted between different export formats (PDF vs Excel). Standardizing on a global rounding utility is recommended.
