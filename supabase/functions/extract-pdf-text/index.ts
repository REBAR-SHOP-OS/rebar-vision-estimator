import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getDocument } from "https://esm.sh/pdfjs-serverless@0.4.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface PdfPageExtraction {
  page_number: number;
  raw_text: string;
  tables: string[][];
  text_blocks: string[];
  is_scanned: boolean;
}

async function hashSHA256(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { pdf_url, pdf_base64 } = await req.json();

    let pdfBytes: ArrayBuffer;
    if (pdf_url) {
      const res = await fetch(pdf_url);
      if (!res.ok) throw new Error(`Failed to fetch PDF: ${res.status}`);
      pdfBytes = await res.arrayBuffer();
    } else if (pdf_base64) {
      const binary = atob(pdf_base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      pdfBytes = bytes.buffer;
    } else {
      throw new Error("Provide pdf_url or pdf_base64");
    }

    const sha256 = await hashSHA256(pdfBytes);
    const pages: PdfPageExtraction[] = [];

    const doc = await getDocument(new Uint8Array(pdfBytes));
    const totalPages = doc.numPages;

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      try {
        const page = await doc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const items = textContent.items.filter((item: any) => item.str && item.str.trim());

        if (items.length < 3) {
          pages.push({ page_number: pageNum, raw_text: "", tables: [], text_blocks: [], is_scanned: true });
          continue;
        }

        // Group by Y-coordinate into rows (3pt threshold)
        const rowMap = new Map<number, { x: number; text: string }[]>();
        for (const item of items) {
          const y = Math.round((item as any).transform?.[5] ?? 0);
          const x = (item as any).transform?.[4] ?? 0;
          let matchedY = y;
          for (const existingY of rowMap.keys()) {
            if (Math.abs(existingY - y) <= 3) { matchedY = existingY; break; }
          }
          if (!rowMap.has(matchedY)) rowMap.set(matchedY, []);
          rowMap.get(matchedY)!.push({ x, text: (item as any).str });
        }

        const sortedYs = [...rowMap.keys()].sort((a, b) => b - a);
        const rows: string[] = [];
        const rowXPositions: number[][] = [];

        for (const y of sortedYs) {
          const rowItems = rowMap.get(y)!.sort((a, b) => a.x - b.x);
          rows.push(rowItems.map(r => r.text).join("  "));
          rowXPositions.push(rowItems.map(r => Math.round(r.x)));
        }

        // Detect tables: 3+ consecutive rows with similar column count
        const tables: string[][] = [];
        let tableStart = -1;
        for (let i = 0; i < rows.length - 2; i++) {
          const colCounts = [rowXPositions[i].length, rowXPositions[i+1]?.length || 0, rowXPositions[i+2]?.length || 0];
          const similar = colCounts.every(c => c >= 3 && Math.abs(c - colCounts[0]) <= 2);
          if (similar && tableStart === -1) tableStart = i;
          else if (!similar && tableStart !== -1) {
            tables.push(rows.slice(tableStart, i + 1));
            tableStart = -1;
          }
        }
        if (tableStart !== -1) tables.push(rows.slice(tableStart));

        pages.push({
          page_number: pageNum,
          raw_text: rows.join("\n"),
          tables,
          text_blocks: rows,
          is_scanned: false,
        });
      } catch (pageErr) {
        console.error(`Page ${pageNum} error:`, pageErr);
        pages.push({ page_number: pageNum, raw_text: "", tables: [], text_blocks: [], is_scanned: true });
      }
    }

    return new Response(JSON.stringify({
      pages,
      total_pages: totalPages,
      sha256,
      has_text_layer: pages.some(p => !p.is_scanned),
      scanned_pages: pages.filter(p => p.is_scanned).map(p => p.page_number),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-pdf-text error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
