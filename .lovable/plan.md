

# Clone iBeam.ai Landing Page Flow for Rebar Estimation

## What iBeam Shows

A marketing landing page with:
1. **Hero** — headline + value prop + CTA
2. **Social proof** — customer logos, stats (revenue growth, time savings)
3. **Feature tabs** — Markup, Faster Estimates, Roll-ups, Custom Templates
4. **4-Step Process** — Upload PDFs → Define Scope → AI Takeoff → QA Review
5. **Pricing tiers** — license-based cards
6. **Trade grid** — supported trades with availability badges
7. **Bid tools section** — Dashboard + Bid Sniper
8. **FAQ accordion**
9. **CTA footer** with demo booking form

## What Changes for Rebar

- Hero: "AI-Powered Rebar Takeoff & Estimating" / "Save 90% time on rebar estimation"
- 4-Step Process adapted: Upload Blueprints → Detect Scope (Follow the Concrete) → AI Takeoff with 5-Layer OCR → Review & Approve
- Feature tabs: Trust-First Totals, Shop Drawing Generation, Evidence Grading, Multi-Discipline Detection
- Trade grid replaced with **5 Construction Buckets**: Substructure, Slab-on-Grade, Superstructure, Masonry, Site/Civil
- Pricing: simplified (single rebar trade focus)
- Social proof: placeholder testimonial slots
- FAQ: rebar-specific questions

## Implementation

### 1. Create `src/pages/LandingPage.tsx`

Single-page marketing site with these sections as React components within the file:

- **Navbar**: Logo + "Pricing" + "Book a Demo" (links to `/auth`)
- **HeroSection**: Large headline, subtext, CTA button → `/auth`, animated background
- **SocialProofBar**: Scrolling logo strip (placeholder company logos)
- **StepsSection**: 4-step horizontal process (Upload → Scope Detection → AI Takeoff → Review)
- **FeaturesSection**: Tabbed feature showcase (Trust-First Workspace, Shop Drawings, Evidence Grading, Multi-Discipline)
- **BucketsGrid**: 5 Construction Buckets as cards with icons
- **PricingSection**: 2-3 tier cards
- **FAQSection**: Accordion with rebar-specific questions
- **CTAFooter**: Final CTA with email capture form

### 2. Update `src/App.tsx`

- Route `/` → `LandingPage` (public, no auth)
- Route `/app` → `Dashboard` (protected)
- Update `AuthRoute` redirect from `/` to `/app`
- Update `ProtectedRoute` to redirect to `/auth` (unchanged)

### 3. Update `src/pages/AuthPage.tsx`

- After successful login, redirect to `/app` instead of `/`

### 4. Design Style

- Dark hero section (graphite/slate) with green accent matching existing `--primary`
- White sections for features/pricing
- Industrial SaaS aesthetic consistent with existing workspace
- Responsive (mobile hamburger menu)
- Smooth scroll between sections

### Files Modified
- `src/App.tsx` — add LandingPage route, change Dashboard to `/app`
- `src/pages/AuthPage.tsx` — update redirect target

### Files Created
- `src/pages/LandingPage.tsx` — full marketing landing page (~400-500 lines)

### Preserved
- All existing Dashboard, workspace, edge functions, auth flow unchanged
- Existing routes `/blueprint-viewer`, `/review/:token` unchanged

