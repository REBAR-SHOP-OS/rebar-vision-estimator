import { supabase } from "@/integrations/supabase/client";
import { getLogoDataUri } from "@/lib/logo-base64";

const SHOP_DRAWING_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-shop-drawing`;

export interface ShopDrawingGenerationOptions {
  scale: string;
  includeDims: boolean;
  layerGrouping: boolean;
  barMarks: boolean;
  drawingPrefix: string;
  notes: string;
}

export const DEFAULT_SHOP_DRAWING_OPTIONS: ShopDrawingGenerationOptions = {
  scale: "1:50",
  includeDims: true,
  layerGrouping: true,
  barMarks: true,
  drawingPrefix: "SD-",
  notes: "",
};

interface GenerateAndStoreShopDrawingParams {
  barList: any[];
  elements: any[];
  scopeData?: any;
  sizeBreakdown?: Record<string, number>;
  projectId?: string;
  options?: Partial<ShopDrawingGenerationOptions>;
  metadata?: Record<string, unknown>;
}

export interface GeneratedShopDrawingResult {
  html: string;
  id: string | null;
  version: number | null;
}

export async function generateAndStoreShopDrawing({
  barList,
  elements,
  scopeData,
  sizeBreakdown,
  projectId,
  options,
  metadata,
}: GenerateAndStoreShopDrawingParams): Promise<GeneratedShopDrawingResult> {
  const mergedOptions: ShopDrawingGenerationOptions = {
    ...DEFAULT_SHOP_DRAWING_OPTIONS,
    ...options,
  };

  const logoDataUri = await getLogoDataUri();
  const resp = await fetch(SHOP_DRAWING_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify({
      barList,
      elements,
      projectName: scopeData?.projectName,
      clientName: scopeData?.clientName,
      standard: scopeData?.standard,
      coatingType: scopeData?.coatingType,
      sizeBreakdown,
      options: mergedOptions,
      logoDataUri,
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: "Shop drawing generation failed" }));
    throw new Error(err.error || "Shop drawing generation failed");
  }

  const data = await resp.json();
  if (!data.html) {
    throw new Error("No HTML returned");
  }

  if (!projectId) {
    return { html: data.html, id: null, version: null };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { html: data.html, id: null, version: null };
  }

  const { data: latestRows, error: latestError } = await supabase
    .from("shop_drawings")
    .select("version")
    .eq("project_id", projectId)
    .order("version", { ascending: false })
    .limit(1);

  if (latestError) {
    throw latestError;
  }

  const nextVersion = (latestRows?.[0]?.version || 0) + 1;
  const storedOptions = {
    ...mergedOptions,
    ...metadata,
  };

  const { data: inserted, error: insertError } = await supabase
    .from("shop_drawings")
    .insert({
      project_id: projectId,
      user_id: user.id,
      options: storedOptions as any,
      html_content: data.html,
      version: nextVersion,
    })
    .select("id, version")
    .single();

  if (insertError) {
    throw insertError;
  }

  return {
    html: data.html,
    id: inserted?.id || null,
    version: inserted?.version ?? nextVersion,
  };
}
