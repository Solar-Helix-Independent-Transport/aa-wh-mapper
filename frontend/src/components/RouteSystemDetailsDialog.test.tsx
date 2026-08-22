import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RouteLegOut, SolarSystemOut } from "../api/types";
import { RouteSystemDetailsDialog } from "./RouteSystemDetailsDialog";

function solarSystem(overrides: Partial<SolarSystemOut> = {}): SolarSystemOut {
  return {
    id: 100,
    name: "Jita",
    security_status: 0.9,
    wormhole_class_id: null,
    visual_effect: null,
    constellation_name: "Kimotoro",
    region_name: "The Forge",
    space_type: "High Sec",
    owner: null,
    statics: [],
    ...overrides,
  };
}

function leg(overrides: Partial<RouteLegOut> = {}): RouteLegOut {
  return {
    connection_type: "stargate",
    life_status: null,
    mass_status: null,
    map_id: null,
    connection_id: null,
    connection: null,
    ...overrides,
  };
}

describe("RouteSystemDetailsDialog", () => {
  it("titles the dialog with the system's name", () => {
    render(
      <RouteSystemDetailsDialog
        system={solarSystem()}
        adjacentLegs={[]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Jita" })).toBeInTheDocument();
  });

  it("shows a wormhole class label instead of the plain space type", () => {
    render(
      <RouteSystemDetailsDialog
        system={solarSystem({ space_type: "Wormhole", wormhole_class_id: 5 })}
        adjacentLegs={[]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("C5")).toBeInTheDocument();
  });

  it("hides the security row for a null security status", () => {
    render(
      <RouteSystemDetailsDialog
        system={solarSystem({ security_status: null })}
        adjacentLegs={[]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText("Security")).not.toBeInTheDocument();
  });

  it("joins constellation and region into the location row", () => {
    render(
      <RouteSystemDetailsDialog
        system={solarSystem()}
        adjacentLegs={[]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Kimotoro · The Forge")).toBeInTheDocument();
  });

  it("shows sovereignty with a ticker when the system has an owner", () => {
    render(
      <RouteSystemDetailsDialog
        system={solarSystem({
          owner: {
            type: "alliance",
            id: 1,
            name: "Test Alliance",
            ticker: "TEST",
            icon_url: "",
          },
        })}
        adjacentLegs={[]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Test Alliance [TEST]")).toBeInTheDocument();
  });

  it("shows an endpoint message when there are no adjacent legs", () => {
    render(
      <RouteSystemDetailsDialog
        system={solarSystem()}
        adjacentLegs={[]}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Endpoint of the route - no adjacent hop."),
    ).toBeInTheDocument();
  });

  it("lists each adjacent leg with its connection type and life status", () => {
    render(
      <RouteSystemDetailsDialog
        system={solarSystem()}
        adjacentLegs={[
          {
            leg: leg({ connection_type: "wormhole", life_status: "lt_1h" }),
            otherSystemName: "Amarr",
          },
          {
            leg: leg({ connection_type: "stargate" }),
            otherSystemName: "Dodixie",
          },
        ]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Amarr")).toBeInTheDocument();
    expect(screen.getByText("Wormhole · < 1h")).toBeInTheDocument();
    expect(screen.getByText("Dodixie")).toBeInTheDocument();
    expect(screen.getByText("Stargate")).toBeInTheDocument();
  });

  it("calls onClose on Close", () => {
    const onClose = vi.fn();
    render(
      <RouteSystemDetailsDialog
        system={solarSystem()}
        adjacentLegs={[]}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
