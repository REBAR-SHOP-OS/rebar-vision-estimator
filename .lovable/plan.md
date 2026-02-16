

## بهبود سیستم بر اساس تحلیل Beam AI

این پلن ویژگی‌های کلیدی از گزارش Beam AI را به سیستم فعلی اضافه می‌کند. تمرکز روی قابلیت‌هایی است که بیشترین تاثیر را دارند و با معماری فعلی سازگار هستند.

---

### 1. Scope Definition Panel (پنل تعریف محدوده)

قبل از شروع تحلیل، کاربر بتواند محدوده کار را مشخص کند — مشابه Beam AI که checkboxes برای trades/systems دارد.

**فایل جدید:** `src/components/chat/ScopeDefinitionPanel.tsx`
- Checkboxes برای 12 دسته عنصر ساختاری: Footings, Grade Beams, Raft Slabs, Walls, Retaining Walls, ICF Walls, CMU Walls, Piers/Pedestals, Columns, Slabs, Stairs, Wire Mesh
- Text area برای "Project-Specific Deviations" (یادداشت‌های خاص پروژه)
- فیلدهای متادیتا: نام مشتری، نوع پروژه (تجاری/مسکونی/صنعتی)
- دکمه "Proceed" که scope انتخاب‌شده را به ChatArea می‌فرستد

**تغییر:** `src/components/chat/ChatArea.tsx`
- بعد از آپلود فایل و قبل از mode picker، ScopeDefinitionPanel نمایش داده شود
- scope انتخاب‌شده به `streamAIResponse` ارسال شود تا در system prompt تزریق شود

**تغییر:** `supabase/functions/analyze-blueprint/index.ts`
- دریافت `scope` از request body
- اضافه کردن scope به system prompt: "Only analyze these element types: [selected]"
- اضافه کردن deviations به system prompt

---

### 2. Excel و PDF Export (خروجی گزارش)

Beam AI Excel و PDF export دارد. این قابلیت را اضافه می‌کنیم.

**تغییر:** `src/components/chat/ValidationResults.tsx`
- اضافه کردن دکمه‌های "Export to Excel" و "Download PDF" بعد از نمایش quote result
- Excel: از کتابخانه `xlsx` (در حال حاضر نصب شده) برای ساخت فایل Excel با شیت‌های: Summary، Elements Detail، Size Breakdown
- PDF: ساخت یک HTML template و استفاده از `window.print()` یا ساخت PDF ساده با CSS print styles

---

### 3. Enhanced Results View (نمای بهبود یافته نتایج)

نمایش نتایج فعلی ساده است. بهبودها:

**تغییر:** `src/components/chat/ValidationResults.tsx`
- اضافه کردن جدول خلاصه وزن بر اساس سایز میلگرد (size breakdown table)
- اضافه کردن قابلیت ویرایش مقادیر: کلیک روی هر عدد برای تغییر آن (inline edit)
- گروه‌بندی elements بر اساس element_type با accordion/collapsible
- نمایش درصد اطمینان (confidence) به صورت بصری با progress bar
- نمایش weight per element در لیست elements

---

### 4. Processing Status Indicator (نشانگر وضعیت پردازش)

**تغییر:** `src/components/chat/StepProgress.tsx`
- اضافه کردن estimated time remaining
- اضافه کردن progress bar کلی
- نمایش وضعیت OCR (مثلا "Running Google Vision OCR..." یا "AI Analysis in progress...")

**تغییر:** `src/components/chat/ChatArea.tsx`
- ارسال وضعیت پردازش واقعی به StepProgress (OCR phase, Analysis phase, Validation phase)

---

### 5. Expanded Element Types (گسترش انواع عناصر)

**تغییر:** `supabase/functions/analyze-blueprint/index.ts`
- گسترش `ALLOWED_ELEMENT_TYPES` از 6 نوع به 12 نوع:
  `FOOTING, GRADE_BEAM, RAFT_SLAB, WALL, RETAINING_WALL, ICF_WALL, CMU_WALL, PIER, COLUMN, SLAB, STAIR, WIRE_MESH, OTHER`
- به‌روزرسانی system prompt با دسته‌بندی‌های جدید

**تغییر:** `supabase/functions/validate-elements/index.ts`
- به‌روزرسانی `ALLOWED_ELEMENT_TYPES` با انواع جدید
- اضافه کردن قوانین completeness مخصوص هر نوع (مثلا SLAB نیاز به thickness و mesh type دارد)

**تغییر:** `supabase/functions/price-elements/index.ts`
- اضافه کردن محاسبات وزن برای انواع جدید (مثلا slabs با area-based calculation)

---

### 6. Project Metadata Enhancement (بهبود متادیتای پروژه)

**تغییر DB:** Migration برای اضافه کردن فیلدهای جدید به جدول `projects`:
- `client_name` (text, nullable)
- `project_type` (text, nullable — commercial/residential/industrial)
- `scope_items` (text[], nullable — selected scope checkboxes)
- `deviations` (text, nullable — project-specific notes)

**تغییر:** `src/pages/Dashboard.tsx`
- هنگام ایجاد پروژه جدید، فیلدهای اضافی ذخیره شوند

---

### جزئیات فنی

| فایل | نوع تغییر | اولویت |
|---|---|---|
| `src/components/chat/ScopeDefinitionPanel.tsx` | جدید | بالا |
| `src/components/chat/ChatArea.tsx` | ویرایش — scope panel + export + status | بالا |
| `src/components/chat/ValidationResults.tsx` | ویرایش — export + enhanced view | بالا |
| `src/components/chat/StepProgress.tsx` | ویرایش — better progress | متوسط |
| `supabase/functions/analyze-blueprint/index.ts` | ویرایش — scope + expanded types | بالا |
| `supabase/functions/validate-elements/index.ts` | ویرایش — expanded types + rules | بالا |
| `supabase/functions/price-elements/index.ts` | ویرایش — new element calculations | متوسط |
| DB Migration | جدید — project metadata fields | متوسط |

### ترتیب اجرا

1. DB Migration (اضافه کردن فیلدهای projects)
2. ScopeDefinitionPanel (کامپوننت جدید)
3. ChatArea (ادغام scope panel + ارسال scope به backend)
4. analyze-blueprint (دریافت scope + expanded types)
5. validate-elements + price-elements (expanded types)
6. ValidationResults (export + enhanced view)
7. StepProgress (بهبود نشانگر)

