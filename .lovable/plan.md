

## رفع مشکل OCR برای فایل‌های PDF

### مشکل
مدل Google Gemini فایل‌های PDF را به عنوان `image_url` قبول نمی‌کند. وقتی URL مستقیم PDF از Storage ارسال می‌شود، خطای زیر برمی‌گردد:
```
Unsupported image format for URL: ...pdf
Supported formats: PNG, JPEG, WebP, GIF
```

### راه‌حل
Gemini از PDF به صورت **data URL با MIME type مشخص** پشتیبانی می‌کند. باید در Edge Function، فایل‌های PDF را از Storage دانلود کنیم، به base64 تبدیل کنیم و با MIME type صحیح (`application/pdf`) ارسال کنیم. فایل‌های تصویری (PNG/JPEG/WebP/GIF) همچنان می‌توانند با URL مستقیم ارسال شوند.

### تغییرات

**فایل `supabase/functions/analyze-blueprint/index.ts`:**

1. قبل از ساختن آرایه `aiMessages`، نوع هر فایل URL بررسی شود:
   - اگر URL به `.pdf` ختم شود: فایل دانلود شود، به base64 تبدیل شود، و به صورت `data:application/pdf;base64,...` ارسال شود
   - اگر تصویر باشد (png/jpg/jpeg/webp/gif): همان URL مستقیم ارسال شود

2. تابع کمکی `convertFileToDataUrl` اضافه شود که:
   - فایل را از signed URL دانلود کند
   - نوع MIME را تشخیص دهد
   - محتوا را به base64 تبدیل کند
   - data URL کامل برگرداند

3. برای جلوگیری از مشکل حافظه (WORKER_LIMIT قبلی):
   - فایل‌ها یکی‌یکی پردازش شوند (نه همزمان)
   - فقط فایل‌های PDF تبدیل شوند (تصاویر نیازی ندارند)

### جزئیات فنی

```text
جریان جدید:
URL فایل --> بررسی پسوند
  |
  +--> PDF? --> دانلود --> base64 --> data:application/pdf;base64,...
  |
  +--> تصویر? --> همان URL مستقیم (image_url)
```

- مدل AI همان `google/gemini-2.5-pro` باقی می‌ماند
- ساختار پرامت‌ها تغییر نمی‌کند
- فقط نحوه ارسال فایل‌ها به مدل تغییر می‌کند

