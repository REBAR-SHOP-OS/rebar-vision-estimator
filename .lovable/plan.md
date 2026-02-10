

## استفاده از لوگوی جدید در سه بخش اپلیکیشن

### خلاصه
لوگوی آپلود شده (`favicon-2.png`) در سه محل استفاده خواهد شد:
1. **Favicon مرورگر** (آیکون کوچک تب مرورگر)
2. **هدر اپلیکیشن** (کنار عنوان)
3. **پس‌زمینه** (جایگزین لوگوی فعلی `logo-bg.png`)

### تغییرات

**1. کپی فایل لوگو به دو محل:**
- `user-uploads://favicon-2.png` به `public/favicon.png` (برای favicon)
- `user-uploads://favicon-2.png` به `src/assets/logo.png` (برای استفاده در React)

**2. فایل `index.html`:**
- اضافه کردن تگ `<link rel="icon" href="/favicon.png" type="image/png">` در head

**3. فایل `src/pages/Dashboard.tsx`:**
- تغییر import از `logo-bg.png` به `logo.png`
- اضافه کردن لوگو در هدر اپلیکیشن (کنار دکمه منو، قبل از عنوان) با سایز کوچک (مثلا 28x28 پیکسل)
- پس‌زمینه بدون تغییر همان لوگوی جدید را نمایش می‌دهد (چون import عوض شده)

### جزئیات فنی

- فایل قدیمی `src/assets/logo-bg.png` دیگر استفاده نمی‌شود
- لوگوی هدر با کلاس `h-7 w-7 rounded-full object-contain` نمایش داده می‌شود
- لوگوی پس‌زمینه همان استایل blur فعلی را حفظ می‌کند

