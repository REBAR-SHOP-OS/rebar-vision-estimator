/**
 * Shared Google Cloud Vision API helpers.
 *
 * Used by: analyze-blueprint, ocr-image, detect-project-type
 *
 * Reads the service-account JSON from:
 *   GOOGLE_VISION_SA_KEY_V2  (preferred)
 *   GOOGLE_VISION_SA_KEY     (fallback)
 *
 * The value may be stored as:
 *   - raw JSON string
 *   - URL-encoded JSON string
 *   - Base64-encoded JSON string
 *   - Double-escaped JSON string
 * All four strategies are tried in order.
 */

import {
  encode as encodeBase64,
  decode as decodeBase64,
} from "https://deno.land/std@0.168.0/encoding/base64.ts";

// ── Internal helpers ──────────────────────────────────────────────────────────

function base64url(data: Uint8Array): string {
  return encodeBase64(data as unknown as string)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\n/g, "");
  const binaryDer = decodeBase64(pemContents);
  return await crypto.subtle.importKey(
    "pkcs8",
    binaryDer as unknown as BufferSource,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function visionAnnotate(
  accessToken: string,
  request: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch("https://vision.googleapis.com/v1/images:annotate", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requests: [request] }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Vision API error: ${res.status} ${errText}`);
  }
  const data = await res.json();
  return (data.responses?.[0] ?? {}) as Record<string, unknown>;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Obtain a short-lived Google Cloud access token scoped to Cloud Vision.
 * The service-account JSON is read from env and decoded with four fallback
 * strategies to handle common secret-storage encoding issues.
 */
export async function getGoogleAccessToken(): Promise<string> {
  const saKeyRaw =
    Deno.env.get("GOOGLE_VISION_SA_KEY_V2") ||
    Deno.env.get("GOOGLE_VISION_SA_KEY");
  if (!saKeyRaw) throw new Error("GOOGLE_VISION_SA_KEY is not configured");

  let sa: Record<string, string> | undefined;
  const cleanJson = saKeyRaw.replace(/^\uFEFF/, "").trim();

  const strategies: Array<() => Record<string, string>> = [
    () => JSON.parse(cleanJson),
    () => JSON.parse(decodeURIComponent(cleanJson)),
    () => JSON.parse(new TextDecoder().decode(decodeBase64(cleanJson))),
    () => JSON.parse(cleanJson.replace(/\\n/g, "\n").replace(/\\"/g, '"')),
  ];
  for (const strategy of strategies) {
    if (sa) break;
    try {
      sa = strategy();
    } catch {
      // try next strategy
    }
  }

  if (!sa?.client_email || !sa?.private_key) {
    throw new Error(
      "GOOGLE_VISION_SA_KEY could not be parsed — " +
        "ensure it is valid JSON with client_email and private_key fields.",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const headerB64 = base64url(
    encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })),
  );
  const payloadB64 = base64url(
    encoder.encode(
      JSON.stringify({
        iss: sa.client_email,
        scope: "https://www.googleapis.com/auth/cloud-vision",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      }),
    ),
  );
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await importPrivateKey(sa.private_key);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(signingInput),
  );
  const jwt = `${signingInput}.${base64url(new Uint8Array(signature))}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(
      `Google OAuth2 token exchange failed: ${tokenRes.status} ${errText}`,
    );
  }
  const tokenData = await tokenRes.json();
  return tokenData.access_token as string;
}

/** Call the Vision API with a base64-encoded image. */
export async function callVisionAPI(
  accessToken: string,
  imageBase64: string,
  features: { type: string; maxResults?: number }[],
  imageContext?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const request: Record<string, unknown> = {
    image: { content: imageBase64 },
    features,
  };
  if (imageContext) request.imageContext = imageContext;
  return visionAnnotate(accessToken, request);
}

/** Call the Vision API with an image URL (avoids downloading in the edge function). */
export async function callVisionAPIByUrl(
  accessToken: string,
  imageUrl: string,
  features: { type: string; maxResults?: number }[],
  imageContext?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const request: Record<string, unknown> = {
    image: { source: { imageUri: imageUrl } },
    features,
  };
  if (imageContext) request.imageContext = imageContext;
  return visionAnnotate(accessToken, request);
}
