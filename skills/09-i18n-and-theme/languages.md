# Language Matrix

Default UI language: **English**. Support 10 languages with automatic RTL/LTR.

| Code | Name | Direction |
|---|---|---|
| en | English | LTR |
| es | Español | LTR |
| fr | Français | LTR |
| de | Deutsch | LTR |
| pt | Português | LTR |
| zh | 中文 | LTR |
| ja | 日本語 | LTR |
| ko | 한국어 | LTR |
| ar | العربية | **RTL** |
| he | עברית | **RTL** |

## Implementation

- `LanguageContext.tsx` exposes `{ lang, setLang, t }`.
- On mount, read from `localStorage.lang`, fall back to `navigator.language`, then `en`.
- Toggle `<html dir="rtl|ltr">` whenever language changes.
- Translation keys live in `src/i18n/{en,es,...}.json`. Missing keys fall back to English, never crash.
- Product names (Lovable Cloud, Supabase, GitHub) stay in English in every locale.