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
  it("splits large bar lists across multiple segment sheets", () => {
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

    expect(sheetCount).toBeGreaterThan(1);
    expect(html).toContain("BAR BENDING SCHEDULE");
    expect(html).toContain("SHAPES");
    expect(html).toContain("LAP SCHEDULE");
    expect(html).toContain("COVER DETAILS");
    expect(html).toContain("TYPICAL SECTION");
    expect(html).toContain("REVISION RECORD");
  });

  it("keeps one row per bar mark in the BBS table", () => {
    const html = buildShopDrawingHtml({
      projectName: "Readable Draft",
      barList: [makeBar(0), makeBar(1), makeBar(2)],
    });

    expect(html).toContain("BM-1");
    expect(html).toContain("BM-2");
    expect(html).toContain("BM-3");
    expect(html).toContain("class=\"bbs-table\"");
    expect(html).toContain("REBAR.SHOP");
  });

  it("generates consolidated segment layout with all zones", () => {
    const html = buildShopDrawingHtml({
      projectName: "Foundation Test",
      barList: [makeBar(0), makeBar(1)],
    });

    expect(html).toContain("PLAN LAYOUT");
    expect(html).toContain("MESH SCHEDULE");
    expect(html).toContain("TYPICAL BAR ARRANGEMENT");
    expect(html).toContain("segment-grid");
  });
});
