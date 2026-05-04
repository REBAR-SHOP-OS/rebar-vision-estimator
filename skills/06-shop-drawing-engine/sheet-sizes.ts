/**
 * Real drawing-sheet sizes (points, 72pt/in).
 * Use these — NEVER auto-shrink-to-page — when rendering drawing exports.
 */
export type SheetSize = "ARCH_C" | "ARCH_D" | "ARCH_E" | "ANSI_B";

export const SHEET_SIZES_PT: Record<SheetSize, { w: number; h: number; label: string }> = {
  ANSI_B: { w: 17 * 72, h: 11 * 72, label: '11"×17" landscape' }, // 1224×792
  ARCH_C: { w: 24 * 72, h: 18 * 72, label: '18"×24" landscape' }, // 1728×1296
  ARCH_D: { w: 36 * 72, h: 24 * 72, label: '24"×36" landscape' }, // 2592×1728
  ARCH_E: { w: 42 * 72, h: 30 * 72, label: '30"×42" landscape' }, // 3024×2160
};

export function pickSheetSize(opts: { hasDenseDetails: boolean; hasMultiViews: boolean }): SheetSize {
  if (opts.hasMultiViews) return "ARCH_D";
  if (opts.hasDenseDetails) return "ARCH_C";
  return "ANSI_B";
}