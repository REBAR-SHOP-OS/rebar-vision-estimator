

## سیستم یادگیری ایجنت - نمونه‌های آموزشی (Training Examples)

### خلاصه
قابلیت "یادگیری" به مغز ایجنت اضافه می‌شود. کاربر می‌تواند نقشه‌ها (ورودی) را به همراه جواب صحیح (خروجی) آپلود کند تا ایجنت از منطق محاسبات یاد بگیرد و در تحلیل‌های آینده از آن الگو پیروی کند.

### درک فایل‌های آپلود شده
- `LONDON_CRU1.xlsx`: جدول محاسبات صحیح شامل وزن میلگرد برای Footings (F1-F8)، Piers (P1-P8)، Step on Grade، FW و سطح Wire Mesh. جمع کل: 5,382.44 کیلوگرم
- `CRU-1-Compressed.pdf` و `CRU-1_Structral_4.pdf`: نقشه‌های ورودی پروژه
- `SD06_TO_SD12.pdf`: نقشه‌های شاپ (Shop Drawings) با جزئیات بار لیست

### تغییرات

**1. جدول جدید `agent_training_examples` در دیتابیس:**
- `id` (uuid, primary key)
- `user_id` (uuid, reference)
- `title` (text) - نام پروژه آموزشی
- `description` (text) - توضیحات اختیاری
- `blueprint_file_paths` (text[]) - مسیر فایل‌های نقشه ورودی در Storage
- `blueprint_file_names` (text[]) - نام فایل‌های نقشه
- `answer_file_path` (text) - مسیر فایل جواب (Excel/PDF) در Storage
- `answer_file_name` (text) - نام فایل جواب
- `answer_text` (text) - محتوای متنی parse شده از فایل جواب (برای تزریق به prompt)
- `created_at` (timestamptz)
- RLS: فقط کاربر خودش دسترسی دارد

**2. نصب کتابخانه `xlsx` (SheetJS):**
- برای parse کردن فایل‌های Excel در مرورگر
- محتوای جدول Excel را استخراج و به متن تبدیل می‌کند
- متن استخراج شده در فیلد `answer_text` ذخیره می‌شود

**3. تغییر `src/components/chat/BrainKnowledgeDialog.tsx`:**
- اضافه کردن تب جدید "Training Examples" با سیستم تب‌بندی
- فرم آپلود نمونه آموزشی شامل:
  - فیلد عنوان (مثلا "CRU-1 LONDON")
  - آپلود فایل‌های نقشه (چند فایل PDF/تصویر) - ورودی
  - آپلود فایل جواب (Excel/PDF) - خروجی
  - textarea برای paste کردن متن جواب (در صورتی که Excel نباشد)
- نمایش لیست نمونه‌های آموزشی ذخیره شده با امکان حذف
- حداکثر 5 نمونه آموزشی (برای جلوگیری از سرریز context)
- هنگام آپلود فایل Excel: خودکار parse شده و متن آن ذخیره می‌شود

**4. تغییر `src/components/chat/ChatArea.tsx`:**
- تابع `fetchKnowledgeContext` گسترش پیدا می‌کند:
  - علاوه بر rules و files، نمونه‌های آموزشی هم از دیتابیس خوانده می‌شوند
  - متن جواب‌ها (`answer_text`) به عنوان `trainingExamples` به Edge Function ارسال می‌شود
  - فایل‌های نقشه آموزشی اختیاری هستند (اگر کاربر بخواهد AI الگوی بصری را هم ببیند)

**5. تغییر `supabase/functions/analyze-blueprint/index.ts`:**
- پارامتر جدید `trainingExamples` در `knowledgeContext` دریافت می‌شود
- نمونه‌های آموزشی به system prompt تزریق می‌شوند به این شکل:

```text
## TRAINING EXAMPLES — REFERENCE CALCULATIONS (MUST study and follow this methodology)

### Example 1: CRU-1 LONDON
The following is the CORRECT rebar estimation for a real project.
Study this carefully and use the SAME methodology, format, and calculation logic for the current project:

[محتوای متنی Excel اینجا قرار می‌گیرد]

---
Use the above examples as your PRIMARY reference for calculation methodology.
```

**6. منطق تزریق هوشمند:**
- فقط `answer_text` (متن جواب) در system prompt قرار می‌گیرد (بهینه از نظر توکن)
- فایل‌های نقشه آموزشی به عنوان visual context ارسال نمی‌شوند (صرفه‌جویی در context)
- اگر `answer_text` خالی باشد ولی `answer_file_path` وجود داشته باشد، فایل جواب به عنوان visual input ارسال می‌شود (fallback)

### جزئیات فنی

```text
جریان یادگیری:
کاربر --> کلیک مغز --> تب "Training Examples"
  |
  +--> آپلود نقشه‌ها (PDF) --> Storage (knowledge/training/blueprints/)
  |
  +--> آپلود فایل جواب (Excel) --> parse با SheetJS --> ذخیره متن در answer_text
  |                               --> Storage (knowledge/training/answers/)
  |
  +--> (اختیاری) paste متن جواب مستقیم
  |
ذخیره در agent_training_examples

هنگام تحلیل:
  ChatArea --> خواندن training_examples --> ارسال answer_text به Edge Function
  Edge Function --> تزریق به system prompt به عنوان "REFERENCE CALCULATIONS"
```

### ساختار UI دیالوگ مغز (پس از تغییر)
- سه بخش با تب‌بندی:
  1. **Rules** - قوانین متنی (موجود)
  2. **Files** - فایل‌های مرجع (موجود)
  3. **Training** - نمونه‌های آموزشی (جدید)

### محدودیت‌ها
- حداکثر 5 نمونه آموزشی
- حداکثر 3 فایل نقشه به ازای هر نمونه
- حداکثر اندازه answer_text: 50,000 کاراکتر (برای جلوگیری از سرریز context window)
- فرمت‌های پشتیبانی شده جواب: Excel (.xlsx, .xls), PDF, Text/CSV

