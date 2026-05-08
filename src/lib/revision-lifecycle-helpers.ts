/**
 * Pure (Supabase-free) helpers for the revision lifecycle.
 *
 * These functions contain no side-effects and can be unit-tested directly.
 * Supabase-integrated operations live in revision-lifecycle.ts.
 */

/**
 * Given a list of document_registry rows for a project, find the active row
 * that would be superseded by a newly uploaded file with the given
 * classification and detected_discipline.
 *
 * Replacement detection rule (Phase A):
 *   same classification AND same detected_discipline (or both null/undefined)
 */
export function findSupersedableRegistryRow(
  rows: Array<{
    id: string;
    file_id: string;
    classification: string;
    detected_discipline: string | null;
    is_active: boolean;
  }>,
  newClassification: string,
  newDiscipline: string | null,
): { id: string; file_id: string } | null {
  const candidate = rows.find(
    (r) =>
      r.is_active &&
      r.classification === newClassification &&
      (r.detected_discipline ?? null) === (newDiscipline ?? null),
  );
  return candidate ? { id: candidate.id, file_id: candidate.file_id } : null;
}

/**
 * Return the ID of the "current" estimate version for a project from a list
 * of estimate rows, or null when the list is empty.
 *
 * Prefers a row with is_current === true; falls back to the row with the
 * highest version_number when no explicit current marker is set.
 */
export function findCurrentEstimateVersionId(
  rows: Array<{ id: string; is_current: boolean; version_number: number }>,
): string | null {
  const current = rows.find((r) => r.is_current);
  if (current) return current.id;
  if (rows.length === 0) return null;
  return rows.slice().sort((a, b) => b.version_number - a.version_number)[0].id;
}
