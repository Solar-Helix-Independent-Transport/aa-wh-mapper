import { useEffect, useRef, useState } from "react";
import { Panel } from "@xyflow/react";
import { TIME_STATUS_COLOR } from "../constants";

const SPACE_SWATCHES: { label: string; color: string }[] = [
  { label: "High sec", color: "#4ade80" },
  { label: "Low sec", color: "#ffb454" },
  { label: "Null sec", color: "#ff5c7a" },
  { label: "Wormhole", color: "#a68cff" },
  { label: "Pochven / Abyssal", color: "#ff8cf0" },
  { label: "Unknown", color: "#7a8099" },
];

// Shown in the bottom toolbar, opens a popover explaining every color and
// line style used on the map so newcomers don't have to guess what a red
// dashed edge or a green-ringed system means.
export function MapLegend() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    // Capture phase, not bubble: a click on the ReactFlow pane/nodes never
    // reaches a bubble-phase document listener (xyflow's own pointer
    // handling stops it first), so this would otherwise never close when
    // clicking anywhere on the map canvas itself.
    document.addEventListener("mousedown", handleClickOutside, true);
    return () =>
      document.removeEventListener("mousedown", handleClickOutside, true);
  }, [open]);

  return (
    <Panel position="bottom-center">
      <div className="map-legend" ref={ref}>
        <button type="button" onClick={() => setOpen((current) => !current)}>
          Legend
        </button>
        {open && (
          <div className="map-legend-popover">
            <div className="map-legend-sections">
              <div className="map-legend-section">
                <h5>Systems</h5>
                <ul>
                  {SPACE_SWATCHES.map((s) => (
                    <li key={s.label}>
                      <span
                        className="legend-swatch"
                        style={{ background: s.color }}
                      />
                      {s.label}
                    </li>
                  ))}
                  <li>
                    <span
                      className="legend-swatch legend-swatch-ring"
                      style={{ borderColor: "var(--success)" }}
                    />
                    Character present
                  </li>
                  <li>
                    <span
                      className="legend-swatch legend-swatch-ring"
                      style={{ borderColor: "var(--accent)" }}
                    />
                    Selected
                  </li>
                  <li>
                    <span
                      className="legend-swatch legend-swatch-ring"
                      style={{ borderColor: "#e8b923" }}
                    />
                    Locked (home base)
                  </li>
                  <li>
                    <span
                      className="legend-swatch legend-swatch-ring"
                      style={{
                        borderColor: "var(--accent-bright)",
                        borderStyle: "dashed",
                      }}
                    />
                    Multi-selected (bulk delete)
                  </li>
                  <li>
                    <span
                      className="legend-dot"
                      style={{ background: "var(--text-dim)" }}
                    />
                    Tracked character
                  </li>
                  <li>
                    <span
                      className="legend-dot"
                      style={{ background: "var(--success)" }}
                    />
                    Your character
                  </li>
                </ul>
              </div>

              <div className="map-legend-section">
                <h5>Connections</h5>
                <ul>
                  <li>
                    <span
                      className="legend-line"
                      style={{ borderColor: TIME_STATUS_COLOR.green }}
                    />
                    Wormhole - plenty of time left
                  </li>
                  <li>
                    <span
                      className="legend-line"
                      style={{ borderColor: TIME_STATUS_COLOR.orange }}
                    />
                    Wormhole - time running out
                  </li>
                  <li>
                    <span
                      className="legend-line"
                      style={{ borderColor: TIME_STATUS_COLOR.red }}
                    />
                    Wormhole - little time left
                  </li>
                  <li>
                    <span
                      className="legend-line"
                      style={{ borderColor: TIME_STATUS_COLOR.unknown }}
                    />
                    Wormhole - unidentified type
                  </li>
                  <li>
                    <span
                      className="legend-line legend-line-dashed"
                      style={{ borderColor: "var(--text-dim)" }}
                    />
                    Mass nearly depleted (dashed, any color above)
                  </li>
                  <li>
                    <span className="legend-badge legend-badge-critical">
                      ≤1h
                    </span>
                    About to collapse
                  </li>
                  <li>
                    <span className="legend-badge">L</span>
                    Ship size supported (S/M/L/XL)
                  </li>
                  <li>
                    <span
                      className="legend-line"
                      style={{ borderColor: "#ffffff" }}
                    />
                    Stargate
                  </li>
                  <li>
                    <span
                      className="legend-line legend-line-dashed"
                      style={{ borderColor: "var(--text-dim)" }}
                    />
                    Ansiblex jump gate
                  </li>
                </ul>
              </div>
            </div>
            <p className="map-legend-hint">
              Shift+drag to box-select multiple systems/connections, then press
              Delete to remove them all.
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}
