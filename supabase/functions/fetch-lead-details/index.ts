import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const REBAR_URL = "https://rzqonxnowjrtbueauziu.supabase.co";
const REBAR_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ6cW9ueG5vd2pydGJ1ZWF1eml1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1ODE2NTMsImV4cCI6MjA4NzE1NzY1M30.3-ryGO4oXzW_4NET5cKYrw0hAI8oY4vvYnuYp5Q6NkY";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }

  try {
    const { lead_id } = await req.json();
    if (!lead_id) {
      return new Response(JSON.stringify({ error: "lead_id is required" }), {
        status: 400,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const rebarClient = createClient(REBAR_URL, REBAR_ANON_KEY);

    // Fetch lead with customer join
    const { data: lead, error: leadError } = await rebarClient
      .from("leads")
      .select("*, customers(name, company_name, email, phone)")
      .eq("id", lead_id)
      .single();

    if (leadError) {
      return new Response(JSON.stringify({ error: leadError.message }), {
        status: 404,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }

    // Fetch files
    const { data: files, error: filesError } = await rebarClient
      .from("lead_files")
      .select("id, lead_id, file_name, file_url, storage_path, mime_type, odoo_id, file_size_bytes, created_at")
      .eq("lead_id", lead_id)
      .order("created_at", { ascending: false });

    // Attempt to fetch messages/chatter — try lead_messages, gracefully degrade
    let messages: any[] = [];
    let messagesTableName = "lead_messages";

    const { data: msgs, error: msgsError } = await rebarClient
      .from("lead_messages")
      .select("*")
      .eq("lead_id", lead_id)
      .order("created_at", { ascending: true });

    if (msgsError) {
      console.warn(`lead_messages query failed: ${msgsError.message}. Trying lead_notes...`);
      // Try alternative table name
      const { data: notes, error: notesError } = await rebarClient
        .from("lead_notes")
        .select("*")
        .eq("lead_id", lead_id)
        .order("created_at", { ascending: true });

      if (notesError) {
        console.warn(`lead_notes also failed: ${notesError.message}. No chatter available.`);
        messagesTableName = "none";
      } else {
        messages = notes || [];
        messagesTableName = "lead_notes";
      }
    } else {
      messages = msgs || [];
    }

    // Build attachments with proper URLs
    const attachments = (files || []).map((f: any) => {
      let url: string | null = null;
      let odooId: string | null = null;

      if (f.storage_path) {
        url = `${REBAR_URL}/storage/v1/object/public/lead-files/${f.storage_path}`;
      } else if (f.odoo_id) {
        odooId = String(f.odoo_id);
      } else if (f.file_url && f.file_url.includes("odoo.com/web/content/")) {
        const match = f.file_url.match(/\/web\/content\/(\d+)/);
        if (match) odooId = match[1];
      } else if (f.file_url) {
        url = f.file_url;
      }

      if (!url && !odooId) return null;

      return {
        id: f.id,
        name: f.file_name || "file",
        size: f.file_size_bytes || 0,
        mimeType: f.mime_type || "application/octet-stream",
        url,
        odooId,
        created_at: f.created_at,
      };
    }).filter(Boolean);

    return new Response(JSON.stringify({
      lead,
      attachments,
      messages,
      messages_table: messagesTableName,
    }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("fetch-lead-details error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
