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
  OTHER: "#6B7280",
};

export interface OverlayElement {
  element_id: string;
  element_type: string;
  status: string;
  bbox: [number, number, number, number]; // [x1, y1, x2, y2] in image pixel coords
  confidence?: number;
  weight_lbs?: number;
}

interface DrawingOverlayProps {
  elements: OverlayElement[];
  selectedId: string | null;
  hoveredId: string | null;
  visibleTypes: Set<string>;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  imageWidth: number;
  imageHeight: number;
}

const DrawingOverlay: React.FC<DrawingOverlayProps> = ({
  elements,
  selectedId,
  hoveredId,
  visibleTypes,
  onSelect,
  onHover,
  imageWidth,
  imageHeight,
}) => {
  if (!imageWidth || !imageHeight) return null;

  const filtered = elements.filter(
    (el) => visibleTypes.has(el.element_type) && el.bbox[2] > el.bbox[0] && el.bbox[3] > el.bbox[1]
  );

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      viewBox={`0 0 ${imageWidth} ${imageHeight}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: "100%" }}
    >
      {filtered.map((el) => {
        const color = ELEMENT_TYPE_COLORS[el.element_type] || ELEMENT_TYPE_COLORS.OTHER;
        const isSelected = el.element_id === selectedId;
        const isHovered = el.element_id === hoveredId;
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
              fillOpacity={isSelected ? 0.2 : isHovered ? 0.15 : 0.08}
              stroke={color}
              strokeWidth={isSelected ? 3 : isHovered ? 2.5 : 2}
              strokeDasharray={isSelected ? "none" : "none"}
              className={`pointer-events-auto cursor-pointer transition-all ${isSelected ? "blueprint-overlay-selected" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(el.element_id);
              }}
              onMouseEnter={() => onHover(el.element_id)}
              onMouseLeave={() => onHover(null)}
            />
            {/* Label */}
            <rect
              x={x}
              y={y - 18}
              width={Math.max(el.element_id.length * 8 + 12, 36)}
              height={18}
              rx={4}
              fill={color}
              fillOpacity={0.9}
              className="pointer-events-none"
            />
            <text
              x={x + 6}
              y={y - 5}
              fill="white"
              fontSize={11}
              fontWeight={600}
              fontFamily="system-ui, sans-serif"
              className="pointer-events-none select-none"
            >
              {el.element_id}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

export default DrawingOverlay;
