

# Rebar Estimator Pro — ChatGPT-Style Engineering App

## خلاصه
اپلیکیشن تخمین وزن میلگرد و وایرمش از روی نقشه‌های ساختمانی با رابط کاربری شبیه ChatGPT. زبان اپ انگلیسی با پشتیبانی چندزبانه.

---

## Pages & Features

### 1. Authentication (Login / Sign Up)
- Clean email & password auth
- Professional minimal design

### 2. Main Layout (ChatGPT-Style)
- **Left Sidebar:** Project history list, "New Project" button, user profile/settings at bottom, collapsible on mobile
- **Main Chat Area:** Conversation messages between user and AI assistant
- **Bottom Input Bar:** Text input + file upload (paperclip icon) + send button
- Dark mode by default with light mode toggle

### 3. New Project
- Click "New Project" → enter project name
- Upload blueprint files (PDF, images, any format) via drag & drop or paperclip button in chat
- AI confirms receipt and starts analysis

### 4. Chat-Based 8-Step Estimation Process
The entire workflow happens as a conversation:

- **Step 1 — OCR & Scope Detection:** Multi-pass AI scan of blueprints, identifies rebar & wire mesh scopes across all disciplines, classifies as Existing/New/Proposed
- **Step 2 — Rebar Type Selection:** Shows 7 types with interactive include/exclude buttons in chat
- **Step 3 — Structural Elements:** Identifies footings, beams, slabs, walls, piers, stairs etc. with ⚠️ for uncertain items
- **Step 4 — Dimensions & Scale:** Extracts measurements, shows in tables, user confirms
- **Step 5 — Quantities:** Element counts, rebar counts, spacing — user confirms
- **Step 5.5 — Length Optimization:** Compares to standard lengths (6m/12m/18m), calculates overlap — skippable
- **Step 6 — Weight Calculation:** Detailed weight breakdown using standard weight tables
- **Step 7 — Weight Summary:** Total by rebar size + grand total
- **Step 8 — Welded Wire Mesh:** Area calculation, mesh type selection (Normal/Stainless/Galvanized/Epoxy), sheet count with 1ft overlap per Canadian standards

### 5. Rich Chat Elements
- Interactive buttons/chips for selections inside messages
- Collapsible sections for detailed calculations
- Formatted tables for dimensions, weights, quantities
- File preview thumbnails
- ⚠️ doubt indicators on uncertain values

### 6. PDF Report
- "Generate Report" button at end of conversation
- Full calculation details, summaries, tables
- Downloadable PDF

### 7. Multi-Language Support
- English UI by default
- Language switcher in settings
- AI responds in user's preferred language

---

## Technical Stack
- **Frontend:** React + TypeScript + Tailwind + shadcn/ui
- **Backend:** Supabase (Lovable Cloud) — Auth, Database, Storage
- **AI:** Edge functions for OCR analysis and estimation logic
- **PDF:** Client-side report generation

