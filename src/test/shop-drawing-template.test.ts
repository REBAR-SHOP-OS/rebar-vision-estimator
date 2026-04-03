import { describe, expect, it } from "vitest";
import { buildShopDrawingHtml } from "@/lib/shop-drawing-template";

const makeBar = (index: number) => ({
  element_id: `F${Math.ceil((index + 1) / 10)}`,
  element_type: index % 2 === 0 ? "FOOTING" : "WALL",
  sub_element: `ZONE-${Math.ceil((index + 1) / 8)}`,
  bar_mark: `BM-${index + 1}`,
  size: index % 3 === 0 ? "20M" : "15M",
  shape_code: index % 5 === 0 ? "17" : "straight",
  qty: 12 + index,
  multiplier: 1,
  length_mm: 2400 + index * 150,
  weight_kg: 18 + index,
});

describe("buildShopDrawingHtml", () => {
  it("splits large bar lists across multiple printable sheets", () => {
    const html = buildShopDrawingHtml({
      projectName: "Big House",
      clientName: "Client",
      barList: Array.from({ length: 48 }, (_, index) => makeBar(index)),
      sizeBreakdown: { "15M": 420, "20M": 580 },
      options: {
        scale: "1:50",
        includeDims: true,
        layerGrouping: true,
        barMarks: true,
        drawingPrefix: "SD-",
        notes: "Verify on site",
      },
    });

    const sheetCount = (html.match(/class="sheet"/g) || []).length;

    expect(sheetCount).toBeGreaterThan(2);
    expect(html).toContain("PLAN LAYOUT / REINFORCEMENT DETAILS");
    expect(html).toContain("Foundation plan and reinforcement details");
    expect(html).toContain("Shape key 1");
    expect(html).toContain("Lap schedule - structural slab");
  });

  it("keeps one row per bar mark instead of compressing them into one sheet summary", () => {
    const html = buildShopDrawingHtml({
      projectName: "Readable Draft",
      barList: [makeBar(0), makeBar(1), makeBar(2)],
    });

    expect(html).toContain("BM-1");
    expect(html).toContain("BM-2");
    expect(html).toContain("BM-3");
    expect(html).toContain("Bar bending schedule 1");
    expect(html).toContain("class=\"bbs-table\"");
    expect(html).toContain("Cover details");
  });
});
