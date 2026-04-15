import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.split(" ").filter(Boolean));
  const tokensB = new Set(b.split(" ").filter(Boolean));
  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  const intersection = [...tokensA].filter((t) => tokensB.has(t)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders(req) });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: claims, error: claimsErr } = await supabase.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (claimsErr || !claims?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders(req) });
    }
    const userId = claims.claims.sub as string;

    const { project_name, client_name, address } = await req.json();
    if (!project_name) {
      return new Response(JSON.stringify({ error: "project_name required" }), { status: 400, headers: corsHeaders(req) });
    }

    const normalized = normalizeName(project_name);

    // Fetch user's existing projects
    const { data: projects } = await supabase
      .from("projects")
      .select("id, name, normalized_name, client_name, status")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200);

    const matches: Array<{ id: string; name: string; similarity: number }> = [];

    for (const p of projects || []) {
      const pNorm = p.normalized_name || normalizeName(p.name);
      const sim = tokenSimilarity(normalized, pNorm);
      // Exact match or high similarity
      if (sim >= 0.6 || normalized === pNorm) {
        matches.push({ id: p.id, name: p.name, similarity: Math.round(sim * 100) / 100 });
      }
    }

    // Sort by similarity descending
    matches.sort((a, b) => b.similarity - a.similarity);

    return new Response(JSON.stringify({
      is_duplicate: matches.length > 0,
      normalized_name: normalized,
      matches: matches.slice(0, 5),
    }), { headers: { ...corsHeaders(req), "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders(req) });
  }
});
