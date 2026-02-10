

## دو تغییر اصلی

### 1. حذف محدودیت نوع فایل - اجازه آپلود همه فایل‌ها

در سه فایل، `accept` attribute روی file input ها محدود به فرمت‌های خاص است. همه آنها به `accept="*"` تغییر می‌کنند تا کاربر بتواند هر نوع فایلی آپلود کند.

**فایل‌های تغییر:**
- `src/pages/Dashboard.tsx` - خط 164: `accept="image/*,.pdf,.dwg,.dxf"` حذف محدودیت
- `src/components/chat/ChatArea.tsx` - خط 533: `accept="image/*,.pdf,.dwg,.dxf"` حذف محدودیت
- `src/components/chat/BrainKnowledgeDialog.tsx` - خطوط 418, 476, 497: حذف محدودیت‌ها

### 2. یادگیری خودکار از چت - ذخیره در مغز ایجنت

بعد از هر پاسخ AI، سیستم به صورت خودکار یک خلاصه از مکالمه را در جدول `agent_knowledge` ذخیره می‌کند تا ایجنت بتواند در پروژه‌های آینده از تجربیات قبلی استفاده کند.

**تغییرات:**

**الف) ساخت Edge Function جدید: `supabase/functions/extract-learning/index.ts`**
- این تابع پیام‌های چت را دریافت می‌کند
- از AI می‌خواهد نکات کلیدی و درس‌های مهم از مکالمه را خلاصه کند
- نتیجه را به عنوان یک rule جدید در `agent_knowledge` ذخیره می‌کند
- نوع: `learned` (برای تمایز از rule های دستی کاربر)

**ب) تغییر `src/components/chat/ChatArea.tsx`:**
- بعد از هر پاسخ کامل AI (در `streamAIResponse`)، یک فراخوانی غیرهمزمان (fire-and-forget) به Edge Function جدید ارسال می‌شود
- این کار بدون تاثیر روی تجربه کاربر انجام می‌شود

**پ) تغییر `src/components/chat/BrainKnowledgeDialog.tsx`:**
- اضافه کردن بخش "Learned" به تب‌ها برای نمایش چیزهایی که ایجنت خودش یاد گرفته
- امکان حذف آیتم‌های یادگرفته شده توسط کاربر

**ت) تغییر `supabase/functions/analyze-blueprint/index.ts`:**
- اضافه کردن آیتم‌های `learned` از `agent_knowledge` به context ایجنت

### جزئیات فنی

**ساختار داده:** از جدول موجود `agent_knowledge` استفاده می‌شود با فیلد `type = 'learned'` برای تمایز.

**Edge Function extract-learning:**
```text
ورودی: messages (آرایه پیام‌ها), userId, projectId
عملکرد: از AI خلاصه‌ای از نکات مهم مکالمه را می‌خواهد
خروجی: ذخیره خلاصه در agent_knowledge با type='learned'
```

**محدودیت‌ها:**
- حداکثر 50 آیتم یادگرفته شده (قدیمی‌ترها حذف می‌شوند)
- فقط وقتی مکالمه حداقل 3 پیام داشته باشد extract انجام می‌شود
- هر 5 پیام یکبار extract انجام می‌شود (نه هر پیام)

