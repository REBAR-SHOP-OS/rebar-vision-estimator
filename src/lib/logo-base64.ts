/**
 * Loads the app logo as a base64 data URI for embedding in exports.
 * Also provides an ArrayBuffer version for ExcelJS image embedding.
 */
import logoUrl from "@/assets/logo.png";

let cachedDataUri: string | null = null;
let cachedBuffer: ArrayBuffer | null = null;

async function loadLogo(): Promise<{ dataUri: string; buffer: ArrayBuffer }> {
  if (cachedDataUri && cachedBuffer) return { dataUri: cachedDataUri, buffer: cachedBuffer };

  const resp = await fetch(logoUrl);
  const blob = await resp.blob();
  const buffer = await blob.arrayBuffer();

  const dataUri = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });

  cachedDataUri = dataUri;
  cachedBuffer = buffer;
  return { dataUri, buffer };
}

export async function getLogoDataUri(): Promise<string> {
  const { dataUri } = await loadLogo();
  return dataUri;
}

export async function getLogoBuffer(): Promise<ArrayBuffer> {
  const { buffer } = await loadLogo();
  return buffer;
}
