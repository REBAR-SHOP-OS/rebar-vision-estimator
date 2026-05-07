import { describe, expect, it } from "vitest";
import { computeFocusTransformForImage, normalizeBboxToImagePixels } from "@/features/workflow-v2/stages/qa-overlay-geometry";

describe("qa overlay geometry", () => {
  it("keeps sane pixel bboxes in image-pixel space", () => {
    expect(normalizeBboxToImagePixels([120, 240, 360, 480], 1000, 2000)).toMatchObject({
      bbox: [120, 240, 360, 480],
      mode: "pixel",
    });
  });

  it("converts normalized bboxes to image pixels", () => {
    expect(normalizeBboxToImagePixels([0.1, 0.2, 0.3, 0.4], 1000, 2000)).toMatchObject({
      bbox: [100, 400, 300, 800],
      mode: "normalized",
    });
  });

  it("converts percentage bboxes to image pixels", () => {
    expect(normalizeBboxToImagePixels([10, 20, 30, 40], 1000, 2000)).toMatchObject({
      bbox: [100, 400, 300, 800],
      mode: "percent",
    });
  });

  it("rejects invalid and off-page bboxes", () => {
    expect(normalizeBboxToImagePixels([10, 10, 10, 20], 1000, 1000).bbox).toBeNull();
    expect(normalizeBboxToImagePixels([1200, 1200, 1300, 1300], 1000, 1000).bbox).toBeNull();
  });

  it("maps the bbox center to the focus point in viewport pixels", () => {
    const tx = computeFocusTransformForImage({
      bbox: [450, 450, 550, 550],
      imgW: 1000,
      imgH: 1000,
      pageBox: { left: 0, top: 0, width: 1000, height: 1000 },
      canvas: { width: 1000, height: 1000 },
      zoom: 2,
      pan: { dx: 0, dy: 0 },
      toolbarSafeTop: 80,
    });

    expect(tx.x + 500 * tx.scale).toBeCloseTo(500);
    expect(tx.y + 500 * tx.scale).toBeCloseTo(80 + (1000 - 80) * 0.52);
  });
});
