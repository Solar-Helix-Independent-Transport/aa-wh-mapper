import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  FleetMemberOut,
  FleetSessionOut,
  SolarSystemOut,
} from "../api/types";
import { FleetOverlay } from "./FleetOverlay";

function solarSystem(id: number, name: string): SolarSystemOut {
  return {
    id,
    name,
    security_status: 0.5,
    wormhole_class_id: null,
    visual_effect: null,
    constellation_name: null,
    region_name: null,
    space_type: "High Sec",
    owner: null,
    statics: [],
  };
}

function member(overrides: Partial<FleetMemberOut> = {}): FleetMemberOut {
  return {
    character_id: 1,
    character_name: "Alice",
    ship_type_name: "Loki",
    solar_system: solarSystem(100, "Jita"),
    hop_distance: 0,
    ...overrides,
  };
}

function session(members: FleetMemberOut[]): FleetSessionOut {
  return {
    id: 1,
    fc_character_id: 1,
    fc_character_name: "Alice",
    fleet_id: 1,
    started_by_id: 1,
    started_at: "2026-01-01T00:00:00Z",
    is_watcher: false,
    is_starter: true,
    members,
  };
}

describe("FleetOverlay", () => {
  it("groups members into a system chain ordered by hop distance", () => {
    render(
      <FleetOverlay
        session={session([
          member({
            character_id: 2,
            hop_distance: 1,
            solar_system: solarSystem(200, "Amarr"),
          }),
          member({
            character_id: 1,
            hop_distance: 0,
            solar_system: solarSystem(100, "Jita"),
          }),
        ])}
      />,
    );

    const pills = screen.getAllByText(/Jita|Amarr/);
    expect(pills[0]).toHaveTextContent("Jita");
    expect(pills[1]).toHaveTextContent("Amarr");
  });

  it("puts systems with an unknown (null) hop distance last", () => {
    render(
      <FleetOverlay
        session={session([
          member({
            character_id: 1,
            hop_distance: null,
            solar_system: solarSystem(300, "Unknown Sys"),
          }),
          member({
            character_id: 2,
            hop_distance: 0,
            solar_system: solarSystem(100, "Jita"),
          }),
        ])}
      />,
    );

    const pills = screen.getAllByText(/Jita|Unknown Sys/);
    expect(pills[0]).toHaveTextContent("Jita");
    expect(pills[1]).toHaveTextContent("Unknown Sys");
  });

  it("counts members grouped at the same system", () => {
    render(
      <FleetOverlay
        session={session([
          member({ character_id: 1, hop_distance: 0 }),
          member({ character_id: 2, hop_distance: 0 }),
        ])}
      />,
    );

    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("bands members by hop distance: With FC, Adjacent, En route, Unknown", () => {
    render(
      <FleetOverlay
        session={session([
          member({ character_id: 1, character_name: "FC", hop_distance: 0 }),
          member({
            character_id: 2,
            character_name: "Adjacent Bob",
            hop_distance: 1,
          }),
          member({
            character_id: 3,
            character_name: "Far Carol",
            hop_distance: 3,
          }),
          member({
            character_id: 4,
            character_name: "Lost Dave",
            hop_distance: null,
          }),
        ])}
      />,
    );

    expect(screen.getByText("With FC (1)")).toBeInTheDocument();
    expect(screen.getByText("Adjacent (1)")).toBeInTheDocument();
    expect(screen.getByText("En route (1)")).toBeInTheDocument();
    expect(screen.getByText("Unknown (1)")).toBeInTheDocument();
    expect(screen.getByText("FC")).toBeInTheDocument();
    expect(screen.getByText("Adjacent Bob")).toBeInTheDocument();
    expect(screen.getByText("Far Carol")).toBeInTheDocument();
    expect(screen.getByText("Lost Dave")).toBeInTheDocument();
  });

  it("shows a member's ship type and current system", () => {
    render(
      <FleetOverlay
        session={session([
          member({
            ship_type_name: "Loki",
            solar_system: solarSystem(100, "Jita"),
          }),
        ])}
      />,
    );

    expect(screen.getByText("Loki · Jita")).toBeInTheDocument();
  });

  it("shows every band header (including zero-count ones) with an empty fleet", () => {
    render(<FleetOverlay session={session([])} />);

    expect(screen.getByText("With FC (0)")).toBeInTheDocument();
    expect(screen.getByText("Adjacent (0)")).toBeInTheDocument();
    expect(screen.getByText("En route (0)")).toBeInTheDocument();
    expect(screen.getByText("Unknown (0)")).toBeInTheDocument();
  });
});
