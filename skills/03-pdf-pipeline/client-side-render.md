# Client-Side PDF Pipeline

`pdf-to-images.ts` renders PDF pages to PNGs in the browser, uploads them
to storage, and returns signed URLs. Use this when:

- The file is **>3 MB** (edge functions can't load it within payload limits).
- You need per-page Vision/OCR analysis (max 3 images per edge call).
- You want progress feedback during long uploads.

## Required setup

- Install `pdfjs-dist`: `bun add pdfjs-dist`.
- Storage bucket `uploads` (or `blueprints`) with the RLS policies from
  `00-architecture/data-model.sql`.
- Worker is loaded from CDN — no extra Vite config needed.

## Usage

```ts
const pages = await renderPdfPagesToImages(signedPdfUrl, projectId, {
  maxPages: 20,
  scale: 1.5,
  onProgress: (i, total) => console.log(`page ${i}/${total}`),
});
// pages[i] = { pageNumber, signedUrl, storagePath, width, height }
```

## Gotchas

- Refreshes the auth session before upload — long loops will otherwise hit JWT expiry.
- Free canvas memory immediately (`canvas.width = 0`) or Safari leaks fast.
- `scale: 1.5` is the sweet spot for Vision OCR; 2.0+ wastes upload bandwidth.