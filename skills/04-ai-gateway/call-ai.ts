/**
 * Typed wrapper around the Lovable AI Gateway.
 * Use from edge functions (Deno) — `LOVABLE_API_KEY` is auto-provisioned.
 * For browser code, route through an edge function — never expose the key.
 */

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export type AIModel =
  | "google/gemini-2.5-flash"
  | "google/gemini-2.5-pro"
  | "google/gemini-3-flash-preview"
  | "google/gemini-3.1-pro-preview"
  | "openai/gpt-5"
  | "openai/gpt-5-mini"
  | "openai/gpt-5-nano"
  | "openai/gpt-5.2";

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  >;
}

export interface CallAIOptions {
  model?: AIModel;
  messages: AIMessage[];
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export async function callAI(opts: CallAIOptions): Promise<string> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY not set");
  const body: Record<string, unknown> = {
    model: opts.model ?? "google/gemini-2.5-flash",
    messages: opts.messages,
    temperature: opts.temperature ?? 0,
    max_tokens: opts.maxTokens ?? 65536,
  };
  if (opts.jsonMode) body.response_format = { type: "json_object" };

  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (res.status === 429) throw new Error("AI_RATE_LIMITED");
  if (res.status === 402) throw new Error("AI_CREDITS_EXHAUSTED");
  if (!res.ok) throw new Error(`AI gateway ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}

export async function callAIJson<T = unknown>(opts: CallAIOptions): Promise<T> {
  const text = await callAI({ ...opts, jsonMode: true });
  return JSON.parse(text) as T;
}