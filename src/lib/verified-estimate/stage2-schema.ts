import { z } from "zod";

const finiteNumber = (label: string) =>
  z.coerce.number({
    invalid_type_error: `${label} must be a number.`,
    required_error: `${label} is required.`,
  }).refine(Number.isFinite, `${label} must be finite.`);

const nullableString = z.string().trim().min(1).nullable().optional();

export const stage2BarLineSchema = z.object({
  size: z.string().trim().min(1, "quote.bar_list[].size is required."),
  qty: finiteNumber("quote.bar_list[].qty"),
  length_mm: finiteNumber("quote.bar_list[].length_mm"),
  multiplier: finiteNumber("quote.bar_list[].multiplier").default(1),
  weight_kg: finiteNumber("quote.bar_list[].weight_kg").optional(),
  element_id: z.string().trim().min(1).optional(),
  sub_element: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  bar_mark: z.string().trim().min(1).optional(),
  shape_code: z.string().trim().min(1).optional(),
  element_type: z.string().trim().min(1).optional(),
  extraction_method: z.string().trim().min(1).optional(),
  source_file_id: nullableString,
  source_file_name: nullableString,
  source_sheet: nullableString,
  source_region: nullableString,
  confidence: finiteNumber("quote.bar_list[].confidence").optional(),
});

export const stage2QuoteSchema = z.object({
  bar_list: z.array(stage2BarLineSchema, {
    required_error: "quote.bar_list is required.",
    invalid_type_error: "quote.bar_list must be an array.",
  }),
  size_breakdown_kg: z.record(finiteNumber("quote.size_breakdown_kg value"), {
    required_error: "quote.size_breakdown_kg is required.",
    invalid_type_error: "quote.size_breakdown_kg must be an object.",
  }),
  total_weight_kg: finiteNumber("quote.total_weight_kg"),
  total_weight_lbs: finiteNumber("quote.total_weight_lbs").optional(),
  reconciliation: z.record(z.string(), z.unknown()).optional(),
  risk_flags: z.array(z.unknown()).optional(),
  job_status: z.string().trim().min(1).optional(),
});

export type Stage2BarLine = z.infer<typeof stage2BarLineSchema>;
export type Stage2Quote = z.infer<typeof stage2QuoteSchema>;

export interface Stage2QuoteValidationError {
  issues: string[];
  blockedReasons: string[];
}

function normalizeIssuePath(path: Array<string | number>) {
  if (path.length === 0) return "quote";
  return `quote.${path.map((part) => typeof part === "number" ? `[${part}]` : part).join(".").replace(".[", "[")}`;
}

export function validateStage2Quote(input: unknown):
  | { success: true; data: Stage2Quote }
  | { success: false; error: Stage2QuoteValidationError } {
  const result = stage2QuoteSchema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }

  const issues = result.error.issues.map((issue) => {
    const path = normalizeIssuePath(issue.path);
    if (issue.message.includes(path)) return issue.message;
    return `${path}: ${issue.message}`;
  });

  return {
    success: false,
    error: {
      issues,
      blockedReasons: issues.map((issue) => `Blocked: Stage 2 output schema mismatch - ${issue}`),
    },
  };
}
