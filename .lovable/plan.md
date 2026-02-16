

## پیاده‌سازی Pipeline "Atomic Truth" با روش ترکیبی + Pricing

این پلن سیستم تحلیل نقشه را از یک prompt ساده به یک pipeline ساختاریافته با validation gates، question generation، و دو حالت قیمت‌گذاری ارتقا می‌دهد.

---

### معماری کلی

سیستم از ۳ لایه تشکیل می‌شود:

1. **AI Analysis Layer** - مدل Gemini با system prompt جدید که خروجی JSON ساختاریافته (ElementUnit) تولید می‌کند
2. **Validation Layer** - Edge Function جدید که خروجی AI را validate می‌کند (Gates + Question Generation)
3. **Pricing Layer** - Edge Function جدید که فقط عناصر READY را قبول و قیمت‌گذاری می‌کند

```text
[Blueprint Upload]
       |
       v
[analyze-blueprint] -- AI outputs ElementUnit[] JSON
       |
       v
[validate-elements] -- Runs 4 Gates + generates Questions
       |
       v
[Frontend] -- Shows results, asks questions for FLAGGED items
       |
       v
[price-elements] -- Only accepts READY elements
       |
       v
[AI Express / Verified Quote]
```

---

### تغییرات فایل‌ها

#### 1. `supabase/functions/analyze-blueprint/index.ts` - بازنویسی System Prompts

هر دو system prompt (Smart و Step-by-Step) بازنویسی می‌شوند تا:
- تمام JSON Schema های ElementUnit، ElementTruth، و Question را شامل شوند
- دستورالعمل 9-مرحله‌ای pipeline (Scope Load تا Pricing Export) در prompt قرار گیرد
- خروجی AI به صورت JSON ساختاریافته باشد نه متن آزاد
- Thresholds (confidence 0.82، min 2 sources، و...) در prompt تعریف شوند
- Minor diff normalization rules (O/0، I/1، S/5) ذکر شوند
- Gate logic دقیق (Identity، Completeness، Consistency، Scope) توضیح داده شود
- AI موظف باشد هر element را با status مشخص (READY/FLAGGED/BLOCKED) برگرداند

تغییر مهم: خروجی AI حالا یک JSON wrapper خواهد داشت:
```text
{
  "elements": [ElementUnit, ...],
  "summary": { ... },
  "quote_modes": {
    "ai_express": { "ready_elements": [...], "excluded": [...] },
    "verified": { "status": "ready" | "pending_answers" }
  }
}
```

همچنین بخش تحلیل متنی (مرحله‌به‌مرحله با جداول و توضیحات) حفظ می‌شود تا کاربر بتواند نتایج را بخواند. JSON ساختاریافته در انتهای پاسخ در یک بلوک مشخص قرار می‌گیرد.

#### 2. ساخت Edge Function جدید: `supabase/functions/validate-elements/index.ts`

این تابع ElementUnit[] را از frontend دریافت و:
- **Identity Gate**: بررسی identity_sources.count >= 2
- **Completeness Gate**: بررسی وجود vertical_bars.size، vertical_bars.qty، ties.size، ties.spacing_mm
- **Consistency Gate**: مقایسه SCHEDULE_ROW با DETAIL و TAG
- **Scope Gate**: بررسی element_type در لیست مجاز
- status هر element را تعیین می‌کند (READY/FLAGGED/BLOCKED)
- برای عناصر FLAGGED، سوالات تولید می‌کند (حداکثر 2 سوال در هر element، 3 در هر job)
- اولویت سوالات: tie spacing > vertical qty > bar size > other
- اگر flagged_elements_count > 3، job را HUMAN_REVIEW_REQUIRED می‌کند

#### 3. ساخت Edge Function جدید: `supabase/functions/price-elements/index.ts`

این تابع:
- فقط ElementTruth با status=READY قبول می‌کند
- اگر FLAGGED/BLOCKED دریافت کند، hard error برمی‌گرداند
- دو خروجی تولید می‌کند:
  - **AI Express**: فقط READY elements + لیست excluded با دلایل
  - **Verified**: اگر همه READY باشند quote نهایی، وگرنه "pending answers"

#### 4. تغییر `src/components/chat/ChatArea.tsx`

- پس از دریافت پاسخ AI، JSON ساختاریافته را parse می‌کند
- آن را به validate-elements ارسال می‌کند
- نتایج validation (gates, questions, status) را نمایش می‌دهد
- اگر سوالاتی وجود داشته باشد، به کاربر نمایش می‌دهد
- پس از پاسخ کاربر به سوالات، re-validate می‌کند
- در نهایت price-elements را فراخوانی و نتیجه quote را نمایش می‌دهد

#### 5. ساخت کامپوننت جدید: `src/components/chat/ValidationResults.tsx`

کامپوننت UI برای نمایش:
- لیست elements با status هر کدام (READY سبز، FLAGGED زرد، BLOCKED قرمز)
- Gate results به صورت بصری
- سوالات interactive برای عناصر FLAGGED
- خلاصه quote (AI Express و Verified)

#### 6. ساخت کامپوننت جدید: `src/components/chat/QuestionCard.tsx`

کامپوننت برای نمایش هر سوال:
- عنوان element و field مورد نظر
- نوع مشکل (CONFLICT, LOW_CONFIDENCE, MISSING)
- گزینه‌ها برای انتخاب
- severity badge (LOW/MED/HIGH/BLOCKING)

#### 7. تغییر `supabase/config.toml`

اضافه کردن دو function جدید:
```text
[functions.validate-elements]
verify_jwt = false

[functions.price-elements]
verify_jwt = false
```

---

### جزئیات فنی Pipeline

**مرحله 1-4 (AI در analyze-blueprint):**
AI مدل Gemini با prompt جدید تمام مراحل Scope Load، Finder، Region Builder، و Triple OCR (شبیه‌سازی شده) را انجام می‌دهد و نتیجه را به فرمت ElementUnit[] خروجی می‌دهد.

**مرحله 5-6 (validate-elements):**
Edge Function بدون AI، با logic خالص JavaScript:
- Field Voting بر اساس OCR passes
- Normalization (O/0، I/1، S/5)
- اجرای 4 Gate
- تولید Questions

**مرحله 7-9 (price-elements):**
Edge Function بدون AI:
- فیلتر READY elements
- محاسبه وزن نهایی بر اساس ElementTruth
- تولید AI Express و Verified quotes

**Flow در Frontend:**
```text
1. کاربر blueprint آپلود می‌کند
2. انتخاب mode (Smart / Step-by-Step)
3. AI تحلیل انجام می‌دهد -> متن + JSON
4. Frontend JSON را extract و به validate-elements ارسال
5. نتایج validation نمایش داده می‌شود
6. اگر سوال وجود دارد -> کاربر پاسخ می‌دهد
7. Re-validate با پاسخ‌های کاربر
8. price-elements فراخوانی -> quote نمایش
```

---

### محدودیت‌ها و نکات

- **بدون تاثیر روی سایر قسمت‌ها**: فقط فایل‌هایی که ذکر شده تغییر می‌کنند
- OCR همچنان توسط Gemini انجام می‌شود (native multimodal) - اگر بعدا Google Vision API اضافه شود، فقط analyze-blueprint تغییر می‌کند
- در حالت Step-by-Step، کاربر همچنان بین مراحل confirm می‌کند
- تمام schema ها و threshold ها در کد hard-code می‌شوند تا قابل تغییر نباشند (مطابق spec "locked")

