import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      project_id,
      recipient_email,
      recipient_name,
      notification_type,
      subject,
      body,
      share_url,
      recipient_phone,
    } = await req.json();

    if (!recipient_email || !notification_type) {
      return new Response(
        JSON.stringify({ error: "recipient_email and notification_type are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const results: { email?: string; sms?: string } = {};

    // --- EMAIL via Resend (if key exists) ---
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      try {
        const emailHtml = buildEmailHtml({
          recipient_name,
          notification_type,
          body,
          share_url,
        });

        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Rebar Shop <notifications@rebar.shop>",
            to: [recipient_email],
            subject: subject || getDefaultSubject(notification_type),
            html: emailHtml,
          }),
        });

        if (emailRes.ok) {
          results.email = "sent";
        } else {
          const errBody = await emailRes.text();
          console.error("Resend error:", errBody);
          results.email = "failed";
        }
      } catch (e) {
        console.error("Email send error:", e);
        results.email = "failed";
      }
    } else {
      console.log("RESEND_API_KEY not configured — skipping email");
      results.email = "skipped_no_key";
    }

    // --- SMS via Twilio (if keys exist) ---
    const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const twilioPhone = Deno.env.get("TWILIO_PHONE_NUMBER");

    if (twilioSid && twilioToken && twilioPhone && recipient_phone) {
      try {
        const smsBody = `${recipient_name || "Reviewer"}, you have a new ${notification_type.replace(/_/g, " ")} at Rebar Shop. ${share_url || ""}`;

        const twilioRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
          {
            method: "POST",
            headers: {
              Authorization: "Basic " + btoa(`${twilioSid}:${twilioToken}`),
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              To: recipient_phone,
              From: twilioPhone,
              Body: smsBody,
            }),
          }
        );

        if (twilioRes.ok) {
          results.sms = "sent";
        } else {
          const errBody = await twilioRes.text();
          console.error("Twilio error:", errBody);
          results.sms = "failed";
        }
      } catch (e) {
        console.error("SMS send error:", e);
        results.sms = "failed";
      }
    } else {
      results.sms = recipient_phone ? "skipped_no_key" : "skipped_no_phone";
    }

    // --- Log to notifications table ---
    const emailStatus = results.email === "sent" ? "sent" : results.email === "skipped_no_key" ? "logged" : "failed";
    const { error: insertErr } = await supabase.from("notifications").insert({
      project_id: project_id || "00000000-0000-0000-0000-000000000000",
      recipient_email,
      recipient_name: recipient_name || null,
      notification_type,
      channel: results.email === "sent" ? "email" : results.sms === "sent" ? "sms" : "in_app",
      subject: subject || getDefaultSubject(notification_type),
      body: body || "",
      status: emailStatus,
      metadata: { results, share_url },
    });

    if (insertErr) console.error("Notification log error:", insertErr);

    return new Response(
      JSON.stringify({ success: true, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("notify-reviewer error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function getDefaultSubject(type: string): string {
  switch (type) {
    case "review_invite": return "📋 New Estimation Ready for Your Review — Rebar Shop";
    case "comment_received": return "💬 New Comment on Your Review — Rebar Shop";
    case "approval_request": return "✅ Quote Ready for Approval — Rebar Shop";
    default: return "Notification from Rebar Shop";
  }
}

function buildEmailHtml(opts: {
  recipient_name?: string;
  notification_type: string;
  body?: string;
  share_url?: string;
}): string {
  const name = opts.recipient_name || "Reviewer";
  const typeLabel = opts.notification_type === "review_invite"
    ? "Estimation Review"
    : opts.notification_type === "approval_request"
    ? "Quote Approval"
    : opts.notification_type === "comment_received"
    ? "New Comment"
    : "Notification";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 40px 20px; margin: 0;">
  <div style="max-width: 560px; margin: 0 auto; background: #1a1a1a; border-radius: 12px; border: 1px solid #333; overflow: hidden;">
    <div style="background: linear-gradient(135deg, #f97316, #ea580c); padding: 24px 32px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; font-weight: 700;">🏗️ Rebar Shop</h1>
      <p style="margin: 4px 0 0; font-size: 13px; color: rgba(255,255,255,0.85);">${typeLabel}</p>
    </div>
    <div style="padding: 32px;">
      <p style="margin: 0 0 16px; font-size: 15px;">Hi <strong>${name}</strong>,</p>
      <p style="margin: 0 0 24px; font-size: 14px; line-height: 1.6; color: #ccc;">
        ${opts.body || `You have a new ${typeLabel.toLowerCase()} waiting for your attention.`}
      </p>
      ${opts.share_url ? `
      <a href="${opts.share_url}" style="display: inline-block; background: #f97316; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 600;">
        Open Review →
      </a>` : ""}
      <p style="margin: 32px 0 0; font-size: 12px; color: #888;">This is an automated notification from Rebar Shop.</p>
    </div>
  </div>
</body>
</html>`;
}
