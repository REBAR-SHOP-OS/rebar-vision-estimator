import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getDocument } from "https://esm.sh/pdfjs-serverless@0.4.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface TitleBlockMetadata {
  sheet_number: string | null;
  sheet_title: string | null;
  revision_code: string | null;
  revision_date: string | null;
  scale_raw: string | null;
  scale_ratio: number | null;
  discipline: string | null;
  drawing_type: string | null;
}

interface PdfPageExtraction {
  page_number: number;
  raw_text: string;
  tables: string[][];
  text_blocks: string[];
  is_scanned: boolean;
  title_block: TitleBlockMetadata;
}

async function hashSHA256(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function extractTitleBlock(text: string): TitleBlockMetadata {
  const tb: TitleBlockMetadata = {
    sheet_number: null, sheet_title: null, revision_code: null,
    revision_date: null, scale_raw: null, scale_ratio: null,
    discipline: null, drawing_type: null,
  };

  // Sheet number: S-101, A-201, M-001, etc.
  const sheetMatch = text.match(/\b([A-Z]{1,2}[-]?\d{2,4}(?:\.\d+)?)\b/);
  if (sheetMatch) tb.sheet_number = sheetMatch[1];

  // Scale: 1:50, 1/4"=1'-0", SCALE: 1:100
  const scaleMatch = text.match(/(?:SCALE[:\s]*)?(\d+\s*[:/]\s*\d+(?:['"]\s*=\s*\d+['"]\s*-?\s*\d*['""]?)?)/i);
  if (scaleMatch) {
    tb.scale_raw = scaleMatch[1].trim();
    const ratioMatch = tb.scale_raw.match(/^(\d+)\s*:\s*(\d+)$/);
    if (ratioMatch) tb.scale_ratio = parseInt(ratioMatch[1]) / parseInt(ratioMatch[2]);
  }

  // Revision code: REV A, REV. B1, R1, etc.
  const revMatch = text.match(/\bREV(?:ISION)?\.?\s*([A-Z0-9]{1,3})\b/i);
  if (revMatch) tb.revision_code = revMatch[1];

  // Revision date patterns
  const dateMatch = text.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/);
  if (dateMatch) tb.revision_date = dateMatch[1];

  // Discipline detection
  const textUpper = text.toUpperCase();
  if (/\bSTRUCTURAL\b/.test(textUpper) || /^S[-]?\d/.test(tb.sheet_number || "")) tb.discipline = "structural";
  else if (/\bARCHITECTURAL\b/.test(textUpper) || /^A[-]?\d/.test(tb.sheet_number || "")) tb.discipline = "architectural";
  else if (/\bMECHANICAL\b/.test(textUpper) || /^M[-]?\d/.test(tb.sheet_number || "")) tb.discipline = "mechanical";
  else if (/\bELECTRICAL\b/.test(textUpper) || /^E[-]?\d/.test(tb.sheet_number || "")) tb.discipline = "electrical";

  // Drawing type detection
  if (/\bFOUNDATION\s*PLAN\b/i.test(text)) tb.drawing_type = "foundation_plan";
  else if (/\bSLAB\s*(?:REINFORCEMENT|REBAR)\s*PLAN\b/i.test(text)) tb.drawing_type = "rebar_plan";
  else if (/\bSCHEDULE\b/i.test(text)) tb.drawing_type = "schedule";
  else if (/\bDETAIL/i.test(text)) tb.drawing_type = "detail";
  else if (/\bSECTION/i.test(text)) tb.drawing_type = "section";
  else if (/\bELEVATION/i.test(text)) tb.drawing_type = "elevation";
  else if (/\bPLAN\b/i.test(text)) tb.drawing_type = "plan";

  // Sheet title: look for common patterns
  const titleMatch = text.match(/(?:SHEET\s*TITLE|DRAWING\s*TITLE)[:\s]*(.+)/i);
  if (titleMatch) tb.sheet_title = titleMatch[1].trim().substring(0, 100);
  else if (tb.drawing_type) tb.sheet_title = tb.drawing_type.replace(/_/g, " ").toUpperCase();

  return tb;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { pdf_url, pdf_base64, project_id } = await req.json();

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
          pages.push({ page_number: pageNum, raw_text: "", tables: [], text_blocks: [], is_scanned: true, title_block: { sheet_number: null, sheet_title: null, revision_code: null, revision_date: null, scale_raw: null, scale_ratio: null, discipline: null, drawing_type: null } });
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

        // Title block metadata extraction via regex
        const fullText = rows.join("\n");
        const titleBlock = extractTitleBlock(fullText);

        pages.push({
          page_number: pageNum,
          raw_text: fullText,
          tables,
          text_blocks: rows,
          is_scanned: false,
          title_block: titleBlock,
        });
      } catch (pageErr) {
        console.error(`Page ${pageNum} error:`, pageErr);
        pages.push({ page_number: pageNum, raw_text: "", tables: [], text_blocks: [], is_scanned: true, title_block: { sheet_number: null, sheet_title: null, revision_code: null, revision_date: null, scale_raw: null, scale_ratio: null, discipline: null, drawing_type: null } });
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
