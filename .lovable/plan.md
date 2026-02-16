

## پیاده‌سازی Google Vision API برای OCR واقعی

Service Account شما دریافت شد. این پلن Google Vision API را به عنوان موتور OCR اصلی در pipeline جایگزین OCR شبیه‌سازی‌شده Gemini می‌کند.

---

### تغییرات

#### 1. ذخیره Service Account به عنوان Secret

کل محتوای فایل JSON سرویس اکانت به عنوان یک secret با نام `GOOGLE_VISION_SA_KEY` ذخیره می‌شود. Edge Function این secret را می‌خواند، JWT تولید می‌کند، و access token از Google دریافت می‌کند.

#### 2. بازنویسی `supabase/functions/analyze-blueprint/index.ts`

تغییرات اصلی:
- اضافه شدن تابع `getGoogleAccessToken()` که از service account یک JWT می‌سازد و آن را با Google OAuth2 تبادل کرده و access token دریافت می‌کند
- اضافه شدن تابع `callVisionAPI(imageBase64, features)` که با access token واقعی Google Vision API را فراخوانی می‌کند
- اضافه شدن تابع `tripleOCR(imageBase64)` که 3 پاس OCR واقعی اجرا می‌کند:
  - **Pass 1 (STANDARD)**: `TEXT_DETECTION` - تشخیص متن عمومی
  - **Pass 2 (ENHANCED)**: `DOCUMENT_TEXT_DETECTION` - تشخیص متن سند (دقت بالاتر برای اعداد کوچک)
  - **Pass 3 (ALT_CROP)**: `TEXT_DETECTION` با `imageContext.languageHints` برای تمرکز روی اعداد و نشانه‌های فنی
- هر پاس confidence و bbox واقعی از Vision API برمی‌گرداند
- نتایج OCR واقعی به system prompt اضافه می‌شوند تا Gemini از داده‌های دقیق‌تر استفاده کند

```text
Flow جدید:
1. PDF/Image دریافت می‌شود
2. تصاویر به Google Vision API ارسال -> 3 پاس OCR واقعی
3. نتایج OCR (متن + confidence + bbox) به Gemini ارسال
4. Gemini با داده‌های OCR واقعی تحلیل ساختاری انجام می‌دهد
5. خروجی ElementUnit[] با engine: "google-vision" به جای "gemini-vision"
```

#### 3. تغییرات System Prompt

System prompt به‌روز می‌شود تا:
- به Gemini بگوید که نتایج OCR واقعی از Google Vision API دریافت شده
- Gemini وظیفه تحلیل ساختاری (شناسایی elements، regions، schedules) را دارد نه OCR
- engine در ocr_passes به `"google-vision"` تغییر می‌کند
- confidence مقادیر واقعی Vision API خواهد بود

---

### جزئیات فنی JWT Authentication

```text
1. Service Account JSON را از secret بخوان
2. JWT Header: {"alg": "RS256", "typ": "JWT"}
3. JWT Payload: {
     "iss": client_email,
     "scope": "https://www.googleapis.com/auth/cloud-vision",
     "aud": "https://oauth2.googleapis.com/token",
     "iat": now,
     "exp": now + 3600
   }
4. JWT را با private_key امضا کن (RS256)
5. POST به https://oauth2.googleapis.com/token
6. access_token دریافت و در Vision API استفاده کن
```

### Vision API Calls

```text
POST https://vision.googleapis.com/v1/images:annotate
Authorization: Bearer {access_token}

Pass 1 (STANDARD):
  features: [{ type: "TEXT_DETECTION" }]

Pass 2 (ENHANCED):
  features: [{ type: "DOCUMENT_TEXT_DETECTION" }]

Pass 3 (ALT_CROP):
  features: [{ type: "TEXT_DETECTION" }]
  imageContext: { languageHints: ["en"] }
```

---

### فایل‌های تغییر یافته

| فایل | نوع تغییر |
|---|---|
| `supabase/functions/analyze-blueprint/index.ts` | بازنویسی - اضافه Vision API + JWT auth |
| Secret: `GOOGLE_VISION_SA_KEY` | جدید - ذخیره service account JSON |

سایر فایل‌ها (validate-elements، price-elements، ChatArea، UI components) بدون تغییر باقی می‌مانند چون فقط موتور OCR عوض می‌شود و خروجی همان ساختار ElementUnit را حفظ می‌کند.

