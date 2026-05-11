/** Canonical verified estimate snapshot (stored in verified_estimate_results.result_json). */

export interface CanonicalEstimateLine {
  line_key: string;
  description: string;
  size: string;
  qty: number;
  multiplier: number;
  length_mm: number;
  weight_kg: number;
  unit: string;
  bar_mark?: string;
  shape_code?: string;
  element_type?: string;
  segment_id?: string;
  source_file_id: string | null;
  source_file_name: string | null;
  source_sheet: string | null;
  source_region: string | null;
  extraction_method: string;
  confidence: number;
  validation_status: string;
  review_required: boolean;
}

export interface CanonicalEstimateResultV1 {
  schema_version: 1;
  lines: CanonicalEstimateLine[];
  quote: {
    bar_list: Record<string, unknown>[];
    size_breakdown_kg: Record<string, number>;
    total_weight_kg: number;
    total_weight_lbs?: number;
    reconciliation?: Record<string, unknown>;
    risk_flags?: unknown[];
    job_status?: string;
  };
  inputs_summary?: {
    file_ids: string[];
    document_version_ids: string[];
  };
}

export const MIN_EXPORT_CONFIDENCE = 0.5;
