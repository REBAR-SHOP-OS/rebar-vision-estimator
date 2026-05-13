import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createCorsHeaders, createJsonHeaders } from "../_shared/cors.ts";

function normalizeBaseUrl(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "");
}

function resolvePublicAppUrl(req: Request) {
  const candidates = [
    Deno.env.get("PUBLIC_APP_URL"),
    Deno.env.get("ALLOWED_ORIGIN"),
    req.headers.get("origin"),
  ];

  for (const candidate of candidates) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized && /^https?:\/\//i.test(normalized)) {
      return normalized;
    }
  }

  return "https://rebar-vision-estimator.lovable.app";
}

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req);
  const jsonHeaders = createJsonHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { project_id, reviewer_email, reviewer_name, review_type, review_data } = await req.json();

    if (!project_id || !reviewer_email) {
      return new Response(JSON.stringify({ error: "project_id and reviewer_email are required" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    const { data: ownedProject, error: projectError } = await supabase
      .from("projects")
      .select("id")
      .eq("id", project_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (projectError) {
      console.error("Project lookup error:", projectError);
      return new Response(JSON.stringify({ error: "Failed to verify project access" }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    if (!ownedProject) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: jsonHeaders,
      });
    }

    const share_token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);

    const { data: share, error: insertError } = await supabase
      .from("review_shares")
      .insert({
        project_id,
        user_id: user.id,
        reviewer_email,
        reviewer_name: reviewer_name || null,
        share_token,
        status: "pending",
        review_type: review_type || "estimation_review",
        review_data: review_data || {},
      })
      .select()
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(JSON.stringify({ error: "Failed to create share" }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    const shareUrl = `${resolvePublicAppUrl(req)}/review/${share_token}`;

    try {
      const totalWeight = review_data?.total_weight_lbs
        ? `${Number(review_data.total_weight_lbs).toLocaleString()} lbs`
        : "N/A";
      const elemCount = review_data?.elements_count || 0;
      const reviewTypeLabel = review_type === "quote_approval"
        ? "Quote Approval"
        : review_type === "customer_quote"
        ? "Customer Quotation"
        : "Estimation Review";

      const notifyBody = `A new ${reviewTypeLabel} is ready for your review.\n\n`
        + `• Total weight: ${totalWeight}\n`
        + `• Elements: ${elemCount}\n\n`
        + `Click the link below to review and leave feedback.`;

      await fetch(`${supabaseUrl}/functions/v1/notify-reviewer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          project_id,
          recipient_email: reviewer_email,
          recipient_name: reviewer_name || reviewer_email,
          notification_type: review_type === "quote_approval" ? "approval_request" : "review_invite",
          subject: `${reviewTypeLabel} — Rebar Shop`,
          body: notifyBody,
          share_url: shareUrl,
          recipient_phone: reviewer_email === "neel@rebar.shop" ? (Deno.env.get("NEEL_PHONE") || null) : null,
        }),
      });
    } catch (notifyErr) {
      console.error("Notification trigger failed (non-blocking):", notifyErr);
    }

    return new Response(JSON.stringify({ share, shareUrl }), {
      headers: jsonHeaders,
    });
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});
