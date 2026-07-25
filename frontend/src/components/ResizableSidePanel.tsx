import type { ReactNode } from "react";

interface Props {
  width: number;
  hidden: boolean;
  onShow: () => void;
  onHide: () => void;
  onResizeStart: (event: React.MouseEvent) => void;
  label: string;
  children: ReactNode;
}

/** A right-edge, drag-to-resize, collapsible side panel - the chrome
 * (wrapper, resize handle, show/hide chevron) MapView's SignaturePanel
 * originated, now shared with RouteFinder/SharedRoute's itinerary sidebar
 * (see useResizablePanel) so both panels look and behave identically
 * rather than each reimplementing the same interaction. */
export function ResizableSidePanel({
  width,
  hidden,
  onShow,
  onHide,
  onResizeStart,
  label,
  children,
}: Props) {
  if (hidden) {
    return (
      <button
        type="button"
        className="resizable-panel-show-button"
        onClick={onShow}
        aria-label={`Show ${label}`}
        title={`Show ${label}`}
      >
        <i className="fas fa-chevron-left" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className="resizable-panel-wrapper" style={{ width }}>
      <div
        className="resizable-panel-resize-handle"
        onMouseDown={onResizeStart}
      />
      <button
        type="button"
        className="resizable-panel-hide-button"
        onClick={onHide}
        aria-label={`Hide ${label}`}
        title={`Hide ${label}`}
      >
        <i className="fas fa-chevron-right" aria-hidden="true" />
      </button>
      {children}
    </div>
  );
}
