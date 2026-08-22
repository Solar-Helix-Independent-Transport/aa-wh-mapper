import { render, screen } from "@testing-library/react";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import type { MapSystemOut, SolarSystemOut } from "../api/types";
import {
  SelectedSystemProvider,
  SystemNode,
  type SystemNodeData,
} from "./SystemNode";

function solarSystem(overrides: Partial<SolarSystemOut> = {}): SolarSystemOut {
  return {
    id: 30000142,
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

function mapSystem(overrides: Partial<MapSystemOut> = {}): MapSystemOut {
  return {
    id: 1,
    map_id: 1,
    solar_system: solarSystem(),
    label: "",
    x: 0,
    y: 0,
    pinned: false,
    added_by_id: null,
    added_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as MapSystemOut;
}

function renderNode(data: SystemNodeData, nodeProps: Partial<NodeProps> = {}) {
  const props = {
    id: "1",
    selected: false,
    data,
    ...nodeProps,
  } as unknown as NodeProps & { data: SystemNodeData };

  return render(<SystemNode {...props} />, { wrapper: ReactFlowProvider });
}

describe("SystemNode", () => {
  it("shows the solar system name when no custom label is set", () => {
    renderNode({ system: mapSystem(), signatureCount: 0, characters: [] });
    expect(screen.getByText("Jita")).toBeInTheDocument();
  });

  it("prefers a custom label over the solar system's real name", () => {
    renderNode({
      system: mapSystem({ label: "Home" }),
      signatureCount: 0,
      characters: [],
    });
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.queryByText("Jita")).not.toBeInTheDocument();
  });

  it("shows k-space security status and the space type badge", () => {
    renderNode({ system: mapSystem(), signatureCount: 0, characters: [] });
    expect(screen.getByText("0.9")).toBeInTheDocument();
    expect(screen.getByText("High Sec")).toBeInTheDocument();
  });

  it("shows the constellation/region location line for k-space", () => {
    renderNode({ system: mapSystem(), signatureCount: 0, characters: [] });
    expect(screen.getByText("Kimotoro · The Forge")).toBeInTheDocument();
  });

  it("shows a wormhole class label instead of security status, and hides the type badge", () => {
    renderNode({
      system: mapSystem({
        solar_system: solarSystem({
          space_type: "Wormhole",
          wormhole_class_id: 3,
          security_status: -1,
        }),
      }),
      signatureCount: 0,
      characters: [],
    });

    expect(screen.getByText("C3")).toBeInTheDocument();
    expect(screen.queryByText("Wormhole")).not.toBeInTheDocument();
  });

  it("skips the location line entirely for a wormhole system", () => {
    renderNode({
      system: mapSystem({
        solar_system: solarSystem({
          space_type: "Wormhole",
          wormhole_class_id: 3,
          constellation_name: "A-C00311",
          region_name: "A-R00001",
        }),
      }),
      signatureCount: 0,
      characters: [],
    });

    expect(screen.queryByText(/A-C00311/)).not.toBeInTheDocument();
  });

  it("shows the owner ticker and hides the type badge when a system has an owner", () => {
    renderNode({
      system: mapSystem({
        solar_system: solarSystem({
          owner: {
            type: "alliance",
            id: 99,
            name: "Test Alliance",
            ticker: "TEST",
            icon_url: "https://example.com/icon.png",
          },
        }),
      }),
      signatureCount: 0,
      characters: [],
    });

    expect(screen.getByText("TEST")).toBeInTheDocument();
    expect(screen.queryByText("High Sec")).not.toBeInTheDocument();
  });

  it("shows a pin icon and pinned class for a locked system", () => {
    const { container } = renderNode({
      system: mapSystem({ pinned: true }),
      signatureCount: 0,
      characters: [],
    });

    expect(screen.getByTitle("Locked home base")).toBeInTheDocument();
    expect(container.querySelector(".system-node")).toHaveClass(
      "system-node-pinned",
    );
  });

  it("adds the multiselected class when xyflow's own selected prop is true", () => {
    const { container } = renderNode(
      { system: mapSystem(), signatureCount: 0, characters: [] },
      { selected: true },
    );
    expect(container.querySelector(".system-node")).toHaveClass(
      "system-node-multiselected",
    );
  });

  it("adds the panel-selected class when this system is the open detail panel", () => {
    const { container } = render(
      <SelectedSystemProvider selectedSystemId={1}>
        <SystemNode
          {...({
            id: "1",
            selected: false,
            data: { system: mapSystem(), signatureCount: 0, characters: [] },
          } as unknown as NodeProps & { data: SystemNodeData })}
        />
      </SelectedSystemProvider>,
      { wrapper: ReactFlowProvider },
    );

    expect(container.querySelector(".system-node")).toHaveClass(
      "system-node-selected",
    );
  });

  it("shows tracked characters, marking the viewer's own with a distinct dot", () => {
    renderNode({
      system: mapSystem(),
      signatureCount: 0,
      characters: [
        { name: "Alice", isOwn: true },
        { name: "Bob", isOwn: false },
      ],
    });

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByTitle("Your character")).toBeInTheDocument();
    expect(screen.getByTitle("Tracked character")).toBeInTheDocument();
  });

  it("pluralizes the signature count badge", () => {
    const { rerender } = renderNode({
      system: mapSystem(),
      signatureCount: 1,
      characters: [],
    });
    expect(screen.getByText("1 sig")).toBeInTheDocument();

    rerender(
      <SystemNode
        {...({
          id: "1",
          selected: false,
          data: { system: mapSystem(), signatureCount: 3, characters: [] },
        } as unknown as NodeProps & { data: SystemNodeData })}
      />,
    );
    expect(screen.getByText("3 sigs")).toBeInTheDocument();
  });

  it("hides the signature badge entirely at zero", () => {
    renderNode({ system: mapSystem(), signatureCount: 0, characters: [] });
    expect(screen.queryByText(/sig/)).not.toBeInTheDocument();
  });

  it("shows a visual effect badge when present", () => {
    renderNode({
      system: mapSystem({
        solar_system: solarSystem({
          space_type: "Wormhole",
          visual_effect: "Black Hole",
        }),
      }),
      signatureCount: 0,
      characters: [],
    });
    expect(screen.getByText("Black Hole")).toBeInTheDocument();
  });

  it("labels a static by its resolved destination class", () => {
    renderNode({
      system: mapSystem({
        solar_system: solarSystem({
          statics: [{ code: "B274", leads_to_class: 7 }],
        }),
      }),
      signatureCount: 0,
      characters: [],
    });

    expect(screen.getByTitle("Static: B274")).toHaveTextContent("High-sec");
  });

  it("falls back to the raw code for a static with no resolvable class", () => {
    renderNode({
      system: mapSystem({
        solar_system: solarSystem({
          statics: [{ code: "???", leads_to_class: null }],
        }),
      }),
      signatureCount: 0,
      characters: [],
    });

    expect(screen.getByTitle("Static: ???")).toHaveTextContent("???");
  });
});
