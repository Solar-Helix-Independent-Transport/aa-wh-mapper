import { useCallback, useEffect, useRef, useState } from "react";

interface Options {
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  widthStorageKey: string;
  hiddenStorageKey: string;
}

// localStorage can throw on access rather than just being unavailable (e.g.
// older Safari private browsing, locked-down/embedded webviews) - these
// wrappers degrade to "nothing stored"/no-op instead of crashing the panel.
function readStoredItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStoredItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Best-effort persistence only - nothing to recover here.
  }
}

/** Drag-to-resize + persisted width/hidden state for a right-edge side
 * panel - originally MapView's SignaturePanel behavior, extracted so
 * RouteFinder/SharedRoute's itinerary sidebar can share the exact same
 * interaction (and the same localStorage keys' shape, one const pair per
 * panel) rather than reimplementing it. Assumes the panel sits on the
 * right edge of its container, so dragging left (negative clientX delta)
 * grows it - true for both existing callers. */
export function useResizablePanel({
  defaultWidth,
  minWidth,
  maxWidth,
  widthStorageKey,
  hiddenStorageKey,
}: Options) {
  const [width, setWidth] = useState<number>(() => {
    const stored = Number(readStoredItem(widthStorageKey));
    return stored >= minWidth && stored <= maxWidth ? stored : defaultWidth;
  });
  const [hidden, setHidden] = useState<boolean>(
    () => readStoredItem(hiddenStorageKey) === "true",
  );
  const isResizingRef = useRef(false);
  // Holds the active drag's own listener-removal function while a resize is
  // in progress, so the unmount effect below can tear it down if the
  // component unmounts mid-drag (e.g. navigating away while the resize
  // handle is held down) instead of leaking `document`-level listeners.
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    writeStoredItem(widthStorageKey, String(width));
  }, [width, widthStorageKey]);

  useEffect(() => {
    writeStoredItem(hiddenStorageKey, String(hidden));
  }, [hidden, hiddenStorageKey]);

  const handleResizeStart = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      isResizingRef.current = true;
      const startX = event.clientX;
      const startWidth = width;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isResizingRef.current) {
          return;
        }
        const next = startWidth + (startX - moveEvent.clientX);
        setWidth(Math.min(Math.max(next, minWidth), maxWidth));
      };
      const stopResizing = () => {
        isResizingRef.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", stopResizing);
        resizeCleanupRef.current = null;
      };
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", stopResizing);
      resizeCleanupRef.current = stopResizing;
    },
    [width, minWidth, maxWidth],
  );

  useEffect(() => {
    return () => resizeCleanupRef.current?.();
  }, []);

  return { width, hidden, setHidden, handleResizeStart };
}
