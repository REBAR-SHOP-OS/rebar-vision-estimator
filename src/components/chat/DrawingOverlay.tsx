import React from "react";

export const ELEMENT_TYPE_COLORS: Record<string, string> = {
  COLUMN: "#3B82F6",
  FOOTING: "#F59E0B",
  BEAM: "#10B981",
  WALL: "#8B5CF6",
  SLAB: "#14B8A6",
  SLAB_STRIP: "#14B8A6",
  PIER: "#EC4899",
  STAIR: "#6366F1",
  GRADE_BEAM: "#10B981",
  RAFT_SLAB: "#14B8A6",
  RETAINING_WALL: "#8B5CF6",
  ICF_WALL: "#8B5CF6",
  CMU_WALL: "#8B5CF6",
  WIRE_MESH: "#6B7280",
  CAGE: "#F97316",
  OTHER: "#6B7280",
};

export interface OverlayElement {
  element_id: string;
  element_type: string;
  status: string;
  bbox: [number, number, number, number]; // [x1, y1, x2, y2] in image pixel coords
  confidence?: number;
  weight_lbs?: number;
  page_number?: number; // PDF page number (1-indexed)
}

export type ReviewStatus = "confirmed" | "rejected" | "active" | "pending";

interface DrawingOverlayProps {
  elements: OverlayElement[];
  selectedId: string | null;
  hoveredId: string | null;
  visibleTypes: Set<string>;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  imageWidth: number;
  imageHeight: number;
  reviewStatuses?: Map<string, ReviewStatus>;
}

const REVIEW_COLORS: Record<string, string> = {
  confirmed: "#22C55E",
  rejected: "#EF4444",
  active: "#3B82F6",
};

const DrawingOverlay: React.FC<DrawingOverlayProps> = ({
  elements,
  selectedId,
  hoveredId,
  visibleTypes,
  onSelect,
  onHover,
  imageWidth,
  imageHeight,
  reviewStatuses,
}) => {
  if (!imageWidth || !imageHeight) return null;

  const filtered = elements.filter(
    (el) => visibleTypes.has(el.element_type) && (el.bbox[2] - el.bbox[0]) > 10 && (el.bbox[3] - el.bbox[1]) > 10
  );

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      viewBox={`0 0 ${imageWidth} ${imageHeight}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: "100%" }}
    >
      {filtered.map((el) => {
        const reviewStatus = reviewStatuses?.get(el.element_id);
        const baseColor = ELEMENT_TYPE_COLORS[el.element_type] || ELEMENT_TYPE_COLORS.OTHER;
        const color = reviewStatus && reviewStatus !== "pending"
          ? REVIEW_COLORS[reviewStatus] || baseColor
          : baseColor;
        const isSelected = el.element_id === selectedId;
        const isHovered = el.element_id === hoveredId;
        const isActive = reviewStatus === "active";
        const x = el.bbox[0];
        const y = el.bbox[1];
        const w = el.bbox[2] - el.bbox[0];
        const h = el.bbox[3] - el.bbox[1];

        return (
          <g key={el.element_id}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              rx={4}
              ry={4}
              fill={color}
              fillOpacity={isActive ? 0.25 : isSelected ? 0.2 : isHovered ? 0.15 : 0.08}
              stroke={color}
              strokeWidth={isActive ? 4 : isSelected ? 3 : isHovered ? 2.5 : 2}
              strokeDasharray={isActive ? "8 4" : "none"}
              className={`pointer-events-auto cursor-pointer transition-all ${
                isActive ? "review-active-element" : isSelected ? "blueprint-overlay-selected" : ""
              }`}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(el.element_id);
              }}
              onMouseEnter={() => onHover(el.element_id)}
              onMouseLeave={() => onHover(null)}
            />
            {/* Label */}
            {(() => {
              const labelText = `${el.element_id} | ${el.element_type}`;
              const labelWidth = Math.max(labelText.length * 7 + 14, 60);
              return (
                <>
                  <rect
                    x={x}
                    y={y - 20}
                    width={labelWidth}
                    height={20}
                    rx={4}
                    fill={color}
                    fillOpacity={0.9}
                    className="pointer-events-none"
                  />
                  <text
                    x={x + 6}
                    y={y - 6}
                    fill="white"
                    fontSize={12}
                    fontWeight={600}
                    fontFamily="system-ui, sans-serif"
                    className="pointer-events-none select-none"
                  >
                    {labelText}
                  </text>
                </>
              );
            })()}
          </g>
        );
      })}
    </svg>
  );
};

export default DrawingOverlay;
