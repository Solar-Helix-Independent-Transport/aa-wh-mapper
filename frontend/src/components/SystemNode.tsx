import { createContext, memo, useContext, type ReactNode } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { MapSystemOut, SystemStaticOut } from "../api/types";
import {
  SPACE_TYPE_CLASS,
  STATIC_LEADS_TO_BADGE_CLASS,
  WORMHOLE_CLASS_DANGER_CSS,
} from "../constants";
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

// A static's badge label - the destination class when known (e.g. "C2",
// "High-sec"), else the raw wormhole type code itself so a static with an
// unrecognized code (see constants.CODE_TO_CLASS) still shows *something*
// rather than a blank chip.
function staticBadgeLabel(wormholeStatic: SystemStaticOut): string {
  return (
    wormholeClassLabel(wormholeStatic.leads_to_class) ?? wormholeStatic.code
  );
}

function staticBadgeClass(leadsToClass: number | null): string {
  if (leadsToClass === null) {
    return "static-badge-unknown";
  }
  return STATIC_LEADS_TO_BADGE_CLASS[leadsToClass] ?? "static-badge-unknown";
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
  // The class now takes over the security-status slot instead (security
  // status on a wormhole is always -1.0, never informative) - see the
  // security-status span below - so this badge just names the broad
  // category again, same as every other space type.
  const headerTypeLabel = solarSystem.space_type;
  // A wormhole system's titlebar is colored by danger (class), not just
  // space type - falls back to the plain space-wormhole purple for Thera
  // and any J-space system whose class couldn't be derived (see
  // WORMHOLE_CLASS_DANGER_CSS's comment for why those two have no entry).
  const spaceTypeClass =
    solarSystem.space_type === "Wormhole"
      ? ((solarSystem.wormhole_class_id !== null
          ? WORMHOLE_CLASS_DANGER_CSS[solarSystem.wormhole_class_id]
          : undefined) ?? "space-wormhole")
      : (SPACE_TYPE_CLASS[solarSystem.space_type] ?? "space-unknown");
  // Constellation/region are internal SDE designations with no in-game
  // meaning for J-space (e.g. "A-C00311 · A-R00001") - the titlebar already
  // conveys everything useful for a wormhole (class, via the security-status
  // slot and the danger-color stripe), so skip this line there entirely
  // rather than showing noise. K-space keeps it - those are real,
  // recognizable region names.
  const location =
    solarSystem.space_type === "Wormhole"
      ? ""
      : [solarSystem.constellation_name, solarSystem.region_name]
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

      {/* Direct child of .system-node (not .system-node-inner below), so it
          can sit outside that div's clipped box (bottom: 100%, see App.css)
          without being cut off - deliberately "loud": every wormhole
          system's fixed static connection(s), always visible rather than
          tucked into a details panel, since where a chain can grow from
          here is exactly what a chain-mapper needs at a glance. */}
      {solarSystem.statics.length > 0 && (
        <div className="system-node-statics">
          {solarSystem.statics.map((wormholeStatic) => (
            <span
              key={wormholeStatic.code}
              className={`system-node-static ${staticBadgeClass(wormholeStatic.leads_to_class)}`}
              title={`Static: ${wormholeStatic.code}`}
            >
              {staticBadgeLabel(wormholeStatic)}
            </span>
          ))}
        </div>
      )}

      <div className="system-node-inner">
        <div className={`system-node-titlebar ${spaceTypeClass}`}>
          {system.pinned && (
            <i
              className="fas fa-thumbtack system-node-pin"
              title="Locked home base"
              aria-hidden="true"
            />
          )}
          {classLabel ? (
            <span className="system-node-security">{classLabel}</span>
          ) : (
            solarSystem.security_status !== null && (
              <span className="system-node-security">
                {solarSystem.security_status.toFixed(1)}
              </span>
            )
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
            // Skipped for wormholes - the security-status slot and the
            // titlebar's danger-color stripe already say everything this
            // badge would ("Wormhole", plus class), so it'd just be noise.
            solarSystem.space_type !== "Wormhole" && (
              <span className="system-node-type">{headerTypeLabel}</span>
            )
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
    </div>
  );
}

export const SystemNode = memo(SystemNodeImpl);
