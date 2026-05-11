/** Deterministic JSON serialization for stable content hashing. */

export function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    out[k] = sortKeysDeep(obj[k]);
  }
  return out;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

/** SHA-256 hex of stable JSON (Web Crypto / Node global). */
export async function sha256HexOfJson(value: unknown): Promise<string> {
  const s = stableStringify(value);
  const enc = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
