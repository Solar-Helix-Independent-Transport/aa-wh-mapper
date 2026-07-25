import type { RouteLegOut, SolarSystemOut } from "../api/types";
import { spaceTypeColor } from "../lib/spaceTypeColor";
import { RouteLegRow } from "./RouteLegRow";

interface Props {
  systems: SolarSystemOut[];
  legs: RouteLegOut[];
  selectedSystemId?: number | null;
}

/** The ordered system list, colored by security status the same way the
 * map's SystemNode titlebar is (see spaceTypeColor) - shared between
 * RouteFinder and SharedRoute so this only needs implementing once. The
 * 1-indexed number matches RouteDiagram's node badges (RouteSystemNode),
 * so a system found here can be spotted in the diagram at a glance.
 * `selectedSystemId` highlights the row matching whichever node was last
 * clicked in RouteDiagram. */
export function RouteItinerary({ systems, legs, selectedSystemId }: Props) {
  return (
    <div className="route-itinerary">
      {systems.map((system, index) => (
        <div
          key={system.id}
          className={
            selectedSystemId === system.id
              ? "route-itinerary-item route-itinerary-item-selected"
              : "route-itinerary-item"
          }
        >
          <span className="route-itinerary-system">
            <span className="route-itinerary-index">{index + 1}</span>
            <span
              className="route-itinerary-security"
              style={{
                color:
                  system.security_status !== null
                    ? spaceTypeColor(system.space_type)
                    : "transparent",
              }}
            >
              {system.security_status !== null
                ? system.security_status.toFixed(1)
                : ""}
            </span>
            {system.name}
          </span>
          {index < legs.length && (
            <RouteLegRow
              leg={legs[index]}
              sourceSystemId={system.id}
              sourceSystemName={system.name}
              targetSystemName={systems[index + 1].name}
            />
          )}
        </div>
      ))}
    </div>
  );
}
