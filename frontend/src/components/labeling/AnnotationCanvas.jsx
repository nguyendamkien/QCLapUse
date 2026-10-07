import { useEffect, useRef, useState } from "react";

const MIN_SIZE = 0.01;
const HANDLE_SIZE = 10;
const OPPOSITE = { nw: "se", ne: "sw", sw: "ne", se: "nw" };

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

// Chuẩn hoá hai điểm bất kỳ thành box {x, y, w, h}
function rectFromPoints(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

function cornerOf(box, handle) {
  return {
    x: handle.includes("w") ? box.x : box.x + box.w,
    y: handle.includes("n") ? box.y : box.y + box.h,
  };
}

/**
 * Lớp SVG phủ lên video để vẽ, chọn, kéo và đổi kích thước box.
 * Box lưu toạ độ chuẩn hoá 0..1, khi vẽ thì nhân với kích thước khung hiển thị.
 * Box keyframe vẽ nét liền, box nội suy vẽ nét đứt. Mỗi box mang màu của người đó (box.color).
 * Kéo bên trong box để di chuyển, kéo 4 góc để đổi kích thước. Chỉnh box nét đứt thì
 * frame đó thành box gán tay (nét liền).
 */
export default function AnnotationCanvas({ boxes, selectedId, draftColor, disabled, onSelect, onCreate, onUpdate }) {
  const svgRef = useRef(null);
  const drag = useRef(null);
  const [draft, setDraft] = useState(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(svgRef.current);
    return () => observer.disconnect();
  }, []);

  const px = (box) => ({
    x: box.x * size.width,
    y: box.y * size.height,
    width: box.w * size.width,
    height: box.h * size.height,
  });

  const pointFromEvent = (event) => {
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / rect.width),
      y: clamp((event.clientY - rect.top) / rect.height),
    };
  };

  const startDrag = (event, state) => {
    if (disabled || event.button !== 0) return;
    event.stopPropagation();
    svgRef.current.setPointerCapture(event.pointerId);
    drag.current = { ...state, start: pointFromEvent(event) };
  };

  const handlePointerMove = (event) => {
    const current = drag.current;
    if (!current) return;
    const point = pointFromEvent(event);

    if (current.type === "draw") {
      setDraft(rectFromPoints(current.start, point));
    } else if (current.type === "move") {
      const { box } = current;
      onUpdate(box.id, {
        x: clamp(box.x + point.x - current.start.x, 0, 1 - box.w),
        y: clamp(box.y + point.y - current.start.y, 0, 1 - box.h),
      });
    } else if (current.type === "resize") {
      const rect = rectFromPoints(current.anchor, point);
      if (rect.w >= MIN_SIZE && rect.h >= MIN_SIZE) onUpdate(current.box.id, rect);
    }
  };

  const handlePointerUp = () => {
    const current = drag.current;
    drag.current = null;
    if (current?.type === "draw") {
      // Kéo đủ lớn thì vẽ box, chỉ bấm vào chỗ trống thì bỏ chọn
      if (draft && draft.w >= MIN_SIZE && draft.h >= MIN_SIZE) onCreate(draft);
      else onSelect(null);
      setDraft(null);
    }
  };

  return (
    <svg
      ref={svgRef}
      className={disabled ? "annotation-canvas disabled" : "annotation-canvas"}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return;
        startDrag(event, { type: "draw" });
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {boxes.map((box) => {
        const selected = box.id === selectedId;
        const rect = px(box);
        return (
          <g key={box.id}>
            <rect
              className="annotation-box"
              {...rect}
              stroke={box.color}
              strokeWidth={selected ? 3 : 2}
              strokeDasharray={box.isKeyframe ? undefined : "6 4"}
              fill={selected ? `${box.color}33` : "transparent"}
              onPointerDown={(event) => {
                if (disabled) return;
                onSelect(box.id);
                startDrag(event, { type: "move", box });
              }}
            />
            <text className="annotation-tag" x={rect.x} y={rect.y - 5} fill={box.color}>
              #{box.track_id}
              {box.isKeyframe ? " ◆" : ""}
              {/* Box do auto label tạo, chưa được người gán xác nhận */}
              {box.auto ? ` AI${box.confidence != null ? ` ${box.confidence.toFixed(2)}` : ""}` : ""}
            </text>
            {selected &&
              !disabled &&
              Object.keys(OPPOSITE).map((handle) => {
                const corner = cornerOf(box, handle);
                return (
                  <rect
                    key={handle}
                    className={`annotation-handle handle-${handle}`}
                    x={corner.x * size.width - HANDLE_SIZE / 2}
                    y={corner.y * size.height - HANDLE_SIZE / 2}
                    width={HANDLE_SIZE}
                    height={HANDLE_SIZE}
                    onPointerDown={(event) =>
                      startDrag(event, { type: "resize", box, anchor: cornerOf(box, OPPOSITE[handle]) })
                    }
                  />
                );
              })}
          </g>
        );
      })}

      {draft && <rect className="annotation-draft" {...px(draft)} stroke={draftColor} />}
    </svg>
  );
}
