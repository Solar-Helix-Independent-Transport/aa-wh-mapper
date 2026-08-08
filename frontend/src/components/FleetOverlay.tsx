import { useMemo } from "react";
import type { FleetMemberOut, FleetSessionOut } from "../api/types";

interface SystemGroup {
  systemId: number;
  systemName: string;
  hopDistance: number | null;
  members: FleetMemberOut[];
}

interface Band {
  label: string;
  match: (member: FleetMemberOut) => boolean;
}

const BANDS: Band[] = [
  { label: "With FC", match: (m) => m.hop_distance === 0 },
  { label: "Adjacent", match: (m) => m.hop_distance === 1 },
  {
    label: "En route",
    match: (m) => m.hop_distance !== null && m.hop_distance > 1,
  },
  { label: "Unknown", match: (m) => m.hop_distance === null },
];

/** Ticket 10's winning fleet-overlay design (Variant C): a compact chain
 * strip of the systems the fleet currently occupies, ordered by hop-
 * distance from the FC, plus four distance-banded columns grouping members
 * by how far they are from the FC. Unlike the ticket 10 prototype (which
 * derived its strip from an unrelated on-demand Route lookup), this builds
 * the strip straight from the session's own member data - a fleet session
 * isn't tied to any particular two-point route someone happened to look up. */
interface Props {
  session: FleetSessionOut;
}

export function FleetOverlay({ session }: Props) {
  const systemGroups = useMemo<SystemGroup[]>(() => {
    const bySystemId = new Map<number, SystemGroup>();
    for (const member of session.members) {
      const existing = bySystemId.get(member.solar_system.id);
      if (existing) {
        existing.members.push(member);
        continue;
      }
      bySystemId.set(member.solar_system.id, {
        systemId: member.solar_system.id,
        systemName: member.solar_system.name,
        hopDistance: member.hop_distance,
        members: [member],
      });
    }
    return Array.from(bySystemId.values()).sort((a, b) => {
      if (a.hopDistance === null) return 1;
      if (b.hopDistance === null) return -1;
      return a.hopDistance - b.hopDistance;
    });
  }, [session.members]);

  return (
    <div className="fleet-overlay">
      <div className="fleet-overlay-chain">
        {systemGroups.map((group, index) => (
          <span key={group.systemId} className="fleet-overlay-chain-item">
            <span className="fleet-overlay-chain-pill">
              {group.systemName}
              {group.members.length > 0 && (
                <span className="fleet-overlay-chain-count">
                  {group.members.length}
                </span>
              )}
            </span>
            {index < systemGroups.length - 1 && (
              <span className="fleet-overlay-chain-arrow">→</span>
            )}
          </span>
        ))}
      </div>

      <div className="fleet-overlay-bands">
        {BANDS.map((band) => {
          const members = session.members.filter(band.match);
          return (
            <div key={band.label} className="fleet-overlay-band">
              <div className="fleet-overlay-band-header">
                {band.label} ({members.length})
              </div>
              {members.map((member) => (
                <div key={member.character_id} className="fleet-overlay-member">
                  <span className="fleet-overlay-member-name">
                    {member.character_name}
                  </span>
                  <span className="fleet-overlay-member-ship">
                    {member.ship_type_name} · {member.solar_system.name}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
