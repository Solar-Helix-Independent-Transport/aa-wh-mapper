import { createContext, memo, useContext, type ReactNode } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { MapSystemOut } from "../api/types";
import { SPACE_TYPE_CLASS } from "../constants";
import { wormholeClassLabel } from "./wormholeClass";

export type SystemNodeCharacter = {
  name: string;
  isOwn: boolean;
};

export type SystemNodeData = {
  system: MapSystemOut;
  signatureCount: number;
  characters: SystemNodeCharacter[];
};

// Which system (if any) is shown in the signature side panel - a single-
// selection concept distinct from xyflow's own `selected` (the box-select/
// ctrl-click multi-selection used for bulk delete). Read via context rather
// than each node's own `data`, so selecting a system doesn't force
// MapCanvas's computedNodes to hand out a new `data` object (and therefore
// force a re-render) for every *other* system on the map too - see
// MapCanvas's computedNodes and SelectedSystemProvider below.
const SelectedSystemIdContext = createContext<number | null>(null);

export function SelectedSystemProvider({
  selectedSystemId,
  children,
}: {
  selectedSystemId: number | null;
  children: ReactNode;
}) {
  return (
    <SelectedSystemIdContext.Provider value={selectedSystemId}>
      {children}
    </SelectedSystemIdContext.Provider>
  );
}

function SystemNodeImpl({
  id,
  data,
  selected,
}: NodeProps & { data: SystemNodeData }) {
  const selectedSystemId = useContext(SelectedSystemIdContext);
  const isPanelSelected = selectedSystemId === Number(id);
  const { system, signatureCount, characters } = data;
  const solarSystem = system.solar_system;
  // wormhole_class_id is set on every system, including k-space (7/8/9 for
  // high/low/null sec) - only meaningful for actual J-space, where it's a
  // more specific type label than the generic "Wormhole" space_type.
  const classLabel =
    solarSystem.space_type === "Wormhole"
      ? wormholeClassLabel(solarSystem.wormhole_class_id)
      : null;
  const headerTypeLabel = classLabel ?? solarSystem.space_type;
  const spaceTypeClass =
    SPACE_TYPE_CLASS[solarSystem.space_type] ?? "space-unknown";
  const location = [solarSystem.constellation_name, solarSystem.region_name]
    .filter(Boolean)
    .join(" · ");

  const classNames = [
    "system-node",
    characters.length > 0 && "system-node-occupied",
    isPanelSelected && "system-node-selected",
    selected && "system-node-multiselected",
    system.pinned && "system-node-pinned",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classNames}>
      {/* One source+target handle pair per side so a connection can start or
          end from wherever is closest to the other node - FloatingEdge then
          re-anchors the rendered line to the exact border point regardless
          of which of these was used. */}
      <Handle type="source" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="target" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="target" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Left} id="left" />
      <Handle type="target" position={Position.Left} id="left" />

      <div className={`system-node-titlebar ${spaceTypeClass}`}>
        {system.pinned && (
          <i
            className="fas fa-thumbtack system-node-pin"
            title="Locked home base"
            aria-hidden="true"
          />
        )}
        <span className="system-node-name">
          {system.label || solarSystem.name}
        </span>
        {solarSystem.owner ? (
          <span
            className="system-node-type system-node-owner"
            title={solarSystem.owner.name}
          >
            <img
              src={solarSystem.owner.icon_url}
              alt=""
              className="system-node-owner-icon"
            />
            {/* Factions have no ticker (SystemOwnerOut.ticker is null for
                them) and their full names are too long for this card -
                icon only, with the name still available via the title
                tooltip. */}
            {solarSystem.owner.ticker}
          </span>
        ) : (
          <span className="system-node-type">{headerTypeLabel}</span>
        )}
      </div>

      <div className="system-node-body">
        <div className="system-node-location">
          {location && <span className="system-node-place">{location}</span>}
          {solarSystem.visual_effect && (
            <span className="system-node-effect">
              {solarSystem.visual_effect}
            </span>
          )}
          {signatureCount > 0 && (
            <span className="system-node-sigs">
              {signatureCount} sig{signatureCount === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {characters.length > 0 && (
          <div className="system-node-characters">
            {characters.map((character) => (
              <div key={character.name} className="system-node-character-row">
                <span
                  className={`system-node-character-dot${character.isOwn ? " own" : ""}`}
                  title={
                    character.isOwn ? "Your character" : "Tracked character"
                  }
                />
                <span className="system-node-character-name">
                  {character.name}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const SystemNode = memo(SystemNodeImpl);
