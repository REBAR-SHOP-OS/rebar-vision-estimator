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
  FINDER_CANDIDATE: "#06B6D4",
};

export interface OverlayElement {
  element_id: string;
  element_type: string;
  status: string;
  bbox: [number, number, number, number];
  confidence?: number;
  weight_lbs?: number;
  page_number?: number;
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

const CORNER_LEN = 20;

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
    (el) =>
      visibleTypes.has(el.element_type) &&
      el.bbox[2] - el.bbox[0] > 10 &&
      el.bbox[3] - el.bbox[1] > 10
  );

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      viewBox={`0 0 ${imageWidth} ${imageHeight}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: "100%" }}
    >
      {/* SVG filter for label drop shadow */}
      <defs>
        <filter id="label-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="2" floodOpacity="0.5" />
        </filter>
      </defs>

      {filtered.map((el) => {
        const reviewStatus = reviewStatuses?.get(el.element_id);
        const baseColor =
          ELEMENT_TYPE_COLORS[el.element_type] || ELEMENT_TYPE_COLORS.OTHER;
        const color =
          reviewStatus && reviewStatus !== "pending"
            ? REVIEW_COLORS[reviewStatus] || baseColor
            : baseColor;
        const isSelected = el.element_id === selectedId;
        const isHovered = el.element_id === hoveredId;
        const isActive = reviewStatus === "active";

        const x = el.bbox[0];
        const y = el.bbox[1];
        const w = el.bbox[2] - el.bbox[0];
        const h = el.bbox[3] - el.bbox[1];
        const cx = x + w / 2;
        const cy = y + h / 2;

        const cLen = Math.min(CORNER_LEN, w / 3, h / 3);
        const sw = isActive ? 3 : isSelected ? 3 : isHovered ? 2.5 : 2;
        const dotR = isSelected || isHovered || isActive ? 20 : 16;

        // Corner bracket paths (L-shapes at each corner)
        const corners = [
          // top-left
          `M${x},${y + cLen} L${x},${y} L${x + cLen},${y}`,
          // top-right
          `M${x + w - cLen},${y} L${x + w},${y} L${x + w},${y + cLen}`,
          // bottom-right
          `M${x + w},${y + h - cLen} L${x + w},${y + h} L${x + w - cLen},${y + h}`,
          // bottom-left
          `M${x + cLen},${y + h} L${x},${y + h} L${x},${y + h - cLen}`,
        ];

        const labelText = `${el.element_id} | ${el.element_type}`;
        const labelWidth = Math.max(labelText.length * 8 + 20, 80);
        const labelH = 24;
        const arrowSize = 6;

        return (
          <g key={el.element_id}>
            {/* Clickable hit area (invisible rect) */}
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill="transparent"
              className="pointer-events-auto cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onSelect(el.element_id);
              }}
              onMouseEnter={() => onHover(el.element_id)}
              onMouseLeave={() => onHover(null)}
            />

            {/* Filled highlight area */}
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              rx={4}
              ry={4}
              fill={color}
              fillOpacity={
                isActive ? 0.2 : isSelected ? 0.2 : isHovered ? 0.15 : 0.06
              }
              stroke="none"
              className="pointer-events-none"
            />

            {/* White glow behind corner brackets */}
            {corners.map((d, i) => (
              <path
                key={`glow-${i}`}
                d={d}
                fill="none"
                stroke="white"
                strokeWidth={sw + 3}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.7}
                className="pointer-events-none"
              />
            ))}

            {/* Corner bracket markers */}
            {corners.map((d, i) => (
              <path
                key={`corner-${i}`}
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={sw}
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`pointer-events-none ${
                  isActive
                    ? "review-active-element"
                    : isSelected
                    ? "blueprint-overlay-selected"
                    : ""
                }`}
              />
            ))}

            {/* Always-visible colored center dot */}
            <circle
              cx={cx}
              cy={cy}
              r={dotR}
              fill={color}
              stroke="white"
              strokeWidth={3}
              className="pointer-events-none"
            />

            {/* Pulsing ring for selected/active */}
            {(isSelected || isActive) && (
              <circle
                cx={cx}
                cy={cy}
                r={6}
                fill={color}
                opacity={0.4}
                className="overlay-pulse pointer-events-none"
              />
            )}

            {/* Always-visible label with pointer arrow */}
            <g filter="url(#label-shadow)" className="pointer-events-none">
              <rect
                x={x}
                y={y - labelH - arrowSize}
                width={labelWidth}
                height={labelH}
                rx={5}
                fill={color}
                fillOpacity={isSelected || isHovered || isActive ? 0.95 : 0.75}
              />
              <polygon
                points={`${x + 12 - arrowSize},${y - arrowSize} ${x + 12 + arrowSize},${y - arrowSize} ${x + 12},${y}`}
                fill={color}
                fillOpacity={isSelected || isHovered || isActive ? 0.95 : 0.75}
              />
              <text
                x={x + 10}
                y={y - arrowSize - 7}
                fill="white"
                fontSize={isSelected || isHovered || isActive ? 15 : 13}
                fontWeight={isSelected || isHovered || isActive ? 800 : 600}
                fontFamily="system-ui, sans-serif"
                className="select-none"
              >
                {labelText}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
};

export default DrawingOverlay;
