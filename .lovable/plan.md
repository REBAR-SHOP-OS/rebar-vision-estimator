

## ذخیره Service Account و پیاده‌سازی Google Vision API

### مرحله 1: ذخیره Secret

محتوای کامل JSON سرویس اکانت (شامل `private_key`، `client_email`، و سایر فیلدها) به عنوان secret با نام `GOOGLE_VISION_SA_KEY` ذخیره می‌شود.

### مرحله 2: بازنویسی `supabase/functions/analyze-blueprint/index.ts`

توابع جدید اضافه می‌شوند:

1. **`getGoogleAccessToken()`** -- JWT با RS256 از private_key ساخته، با Google OAuth2 تبادل، و access token دریافت می‌شود
2. **`callVisionAPI(imageBase64, features, imageContext?)`** -- فراخوانی واقعی Vision API با access token
3. **`tripleOCR(imageBase64)`** -- سه پاس OCR:
   - Pass 1: `TEXT_DETECTION` (عمومی)
   - Pass 2: `DOCUMENT_TEXT_DETECTION` (سند)
   - Pass 3: `TEXT_DETECTION` + `languageHints: ["en"]`
4. **تزریق نتایج OCR به Gemini** -- نتایج واقعی Vision API (متن + confidence + bbox) به پیام کاربر اضافه شده و Gemini فقط تحلیل ساختاری انجام می‌دهد

### مرحله 3: به‌روزرسانی System Prompt

- engine در `ocr_passes` از `"gemini-vision"` به `"google-vision"` تغییر می‌کند
- به Gemini اطلاع داده می‌شود که OCR واقعی انجام شده و فقط باید ساختار استخراج کند
- confidence مقادیر واقعی از Vision API خواهد بود

### جزئیات فنی

| مورد | جزئیات |
|---|---|
| Secret Name | `GOOGLE_VISION_SA_KEY` |
| Auth Flow | JWT RS256 -> Google OAuth2 -> Access Token |
| Vision Endpoint | `https://vision.googleapis.com/v1/images:annotate` |
| فایل تغییر یافته | `supabase/functions/analyze-blueprint/index.ts` |

### توصیه امنیتی

از آنجا که کلید خصوصی در چت نمایش داده شد، پس از ذخیره secret:
1. به Google Cloud Console بروید
2. در IAM > Service Accounts > Keys کلید فعلی را حذف کنید
3. کلید جدید بسازید و مقدار secret را به‌روزرسانی کنید

