import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type ContextMenuItem =
  | {
      kind: "action";
      label: string;
      onClick: () => void;
      danger?: boolean;
      disabled?: boolean;
    }
  | { kind: "submenu"; label: string; items: ContextMenuItem[] }
  | { kind: "separator" };

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

// A generic right-click menu for the map canvas (pane/system/connection) -
// positioned at the click point in viewport coordinates, then nudged back
// on screen if it would render off the right/bottom edge.
export function ContextMenu({ x, y, items, onClose }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
    setPosition({ left: Math.min(x, maxLeft), top: Math.min(y, maxTop) });
  }, [x, y]);

  useEffect(() => {
    // Capture phase, not bubble: react-flow's pane handles mousedown itself
    // for panning/drag-select and stops it from bubbling, so a bubble-phase
    // document listener never sees a click on the canvas itself. Capture
    // runs top-down before that can happen, so this always sees the click
    // regardless of what any element beneath it does afterward.
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    const handleDismiss = () => onClose();
    document.addEventListener("mousedown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleDismiss, true);
    window.addEventListener("resize", handleDismiss);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleDismiss, true);
      window.removeEventListener("resize", handleDismiss);
    };
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      className="context-menu"
      style={{ left: position.left, top: position.top }}
    >
      <ContextMenuList items={items} onClose={onClose} />
    </div>
  );
}

function ContextMenuList({
  items,
  onClose,
}: {
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <ul className="context-menu-list">
      {items.map((item, index) => {
        if (item.kind === "separator") {
          return (
            <li
              key={index}
              className="context-menu-separator"
              role="separator"
            />
          );
        }
        if (item.kind === "submenu") {
          return (
            <li
              key={index}
              className="context-menu-item context-menu-item-submenu"
              onMouseEnter={() => setOpenIndex(index)}
              onMouseLeave={() =>
                setOpenIndex((current) => (current === index ? null : current))
              }
            >
              <span>{item.label}</span>
              <span className="context-menu-arrow" aria-hidden="true">
                ▸
              </span>
              {openIndex === index && (
                <div className="context-menu-submenu">
                  <ContextMenuList items={item.items} onClose={onClose} />
                </div>
              )}
            </li>
          );
        }
        return (
          <li key={index}>
            <button
              type="button"
              className={`context-menu-item${item.danger ? " danger" : ""}`}
              disabled={item.disabled}
              onClick={() => {
                item.onClick();
                onClose();
              }}
            >
              {item.label}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
