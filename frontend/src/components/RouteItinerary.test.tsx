import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RouteLegOut, SolarSystemOut } from "../api/types";
import { RouteItinerary } from "./RouteItinerary";

function solarSystem(
  id: number,
  name: string,
  overrides: Partial<SolarSystemOut> = {},
): SolarSystemOut {
  return {
    id,
    name,
    security_status: 0.9,
    wormhole_class_id: null,
    visual_effect: null,
    constellation_name: null,
    region_name: null,
    space_type: "High Sec",
    owner: null,
    statics: [],
    ...overrides,
  };
}

function leg(): RouteLegOut {
  return {
    connection_type: "stargate",
    life_status: null,
    mass_status: null,
    map_id: null,
    connection_id: null,
    connection: null,
  };
}

describe("RouteItinerary", () => {
  it("lists every system with its 1-indexed position", () => {
    render(
      <RouteItinerary
        systems={[solarSystem(1, "Jita"), solarSystem(2, "Amarr")]}
        legs={[leg()]}
      />,
    );

    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Jita")).toBeInTheDocument();
    expect(screen.getByText("Amarr")).toBeInTheDocument();
  });

  it("formats a real security status to one decimal", () => {
    render(
      <RouteItinerary
        systems={[solarSystem(1, "Jita", { security_status: 0.94 })]}
        legs={[]}
      />,
    );
    expect(screen.getByText("0.9")).toBeInTheDocument();
  });

  it("shows nothing for a null security status (J-space)", () => {
    render(
      <RouteItinerary
        systems={[
          solarSystem(1, "J123456", {
            security_status: null,
            space_type: "Wormhole",
          }),
        ]}
        legs={[]}
      />,
    );
    expect(screen.getByText("J123456")).toBeInTheDocument();
    expect(screen.queryByText("-1.0")).not.toBeInTheDocument();
  });

  it("highlights the row matching selectedSystemId", () => {
    const { container } = render(
      <RouteItinerary
        systems={[solarSystem(1, "Jita"), solarSystem(2, "Amarr")]}
        legs={[leg()]}
        selectedSystemId={2}
      />,
    );

    const items = container.querySelectorAll(".route-itinerary-item");
    expect(items[0]).not.toHaveClass("route-itinerary-item-selected");
    expect(items[1]).toHaveClass("route-itinerary-item-selected");
  });

  it("renders exactly one leg row between two systems", () => {
    const { container } = render(
      <RouteItinerary
        systems={[solarSystem(1, "Jita"), solarSystem(2, "Amarr")]}
        legs={[leg()]}
      />,
    );

    expect(container.querySelectorAll(".route-leg-row")).toHaveLength(1);
  });

  it("renders no leg row for a lone system with no legs", () => {
    const { container } = render(
      <RouteItinerary systems={[solarSystem(1, "Jita")]} legs={[]} />,
    );

    expect(container.querySelectorAll(".route-leg-row")).toHaveLength(0);
  });
});
