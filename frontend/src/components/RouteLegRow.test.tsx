import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { removeConnection, updateConnection } from "../api/maps";
import { createConnectionFlag } from "../api/route";
import type { RouteLegOut, WormholeConnectionOut } from "../api/types";
import { RouteLegRow } from "./RouteLegRow";

vi.mock("../api/maps", () => ({
  updateConnection: vi.fn(),
  removeConnection: vi.fn(),
}));
vi.mock("../api/route", () => ({
  createConnectionFlag: vi.fn(),
}));

function connection(
  overrides: Partial<WormholeConnectionOut> = {},
): WormholeConnectionOut {
  return {
    id: 1,
    map_id: 1,
    connection_type: "wormhole",
    top_system_id: 10,
    bottom_system_id: 20,
    top_system_solar_system_id: 100,
    bottom_system_solar_system_id: 200,
    top_signature_id: null,
    bottom_signature_id: null,
    top_signature: null,
    bottom_signature: null,
    life_status: "stable",
    life_status_marked_at: null,
    mass_status: "unknown",
    ship_size_limit: "unknown",
    time_status: "unknown",
    created_by_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function leg(overrides: Partial<RouteLegOut> = {}): RouteLegOut {
  return {
    connection_type: "wormhole",
    life_status: "stable",
    mass_status: "unknown",
    map_id: 1,
    connection_id: 1,
    connection: connection(),
    ...overrides,
  };
}

const baseProps = {
  sourceSystemId: 100,
  sourceSystemName: "Jita",
  targetSystemName: "Amarr",
};

describe("RouteLegRow", () => {
  beforeEach(() => {
    vi.mocked(updateConnection).mockReset();
    vi.mocked(removeConnection).mockReset();
    vi.mocked(createConnectionFlag).mockReset();
  });

  it("shows the life status label", () => {
    render(<RouteLegRow leg={leg({ life_status: "lt_1h" })} {...baseProps} />);
    expect(screen.getByText("< 1h", { selector: "span" })).toBeInTheDocument();
  });

  it("shows the mass status unless it's unknown", () => {
    render(
      <RouteLegRow leg={leg({ mass_status: "critical" })} {...baseProps} />,
    );
    expect(screen.getByText("critical mass")).toBeInTheDocument();
  });

  it("hides the mass badge when mass_status is unknown", () => {
    render(
      <RouteLegRow leg={leg({ mass_status: "unknown" })} {...baseProps} />,
    );
    expect(screen.queryByText(/mass$/)).not.toBeInTheDocument();
  });

  it("shows a ship size badge for a recognized limit", () => {
    render(
      <RouteLegRow
        leg={leg({ connection: connection({ ship_size_limit: "large" }) })}
        {...baseProps}
      />,
    );
    expect(screen.getByTitle("Ship size limit")).toHaveTextContent("L");
  });

  it("shows the source system's signature id when present", () => {
    render(
      <RouteLegRow
        leg={leg({
          connection: connection({
            top_system_solar_system_id: 100,
            top_signature: {
              id: 1,
              map_system_id: 1,
              signature_id: "ABC-123",
              sig_type: "wormhole",
              wormhole_type: null,
              life_status: "stable",
              life_status_marked_at: null,
              is_hidden: false,
              updated_by_id: null,
              updated_at: "2026-01-01T00:00:00Z",
            },
          }),
        })}
        {...baseProps}
      />,
    );

    expect(screen.getByText("Jita")).toBeInTheDocument();
    expect(screen.getByText("ABC-123")).toBeInTheDocument();
  });

  it("hides the mark-time/mark-mass controls for an ansiblex leg", () => {
    render(
      <RouteLegRow
        leg={leg({
          connection_type: "ansiblex",
          connection: connection({ connection_type: "ansiblex" }),
        })}
        {...baseProps}
      />,
    );

    expect(screen.queryByText("Mark time…")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mark offline" }),
    ).toBeInTheDocument();
  });

  it("labels the removal button 'Mark collapsed' for a wormhole", () => {
    render(<RouteLegRow leg={leg()} {...baseProps} />);
    expect(
      screen.getByRole("button", { name: "Mark collapsed" }),
    ).toBeInTheDocument();
  });

  it("hides every control for a stargate leg", () => {
    render(
      <RouteLegRow
        leg={leg({
          connection_type: "stargate",
          connection: connection({ connection_type: "stargate" }),
        })}
        {...baseProps}
      />,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("hides controls when the leg has no connection_id (nothing to act on)", () => {
    render(<RouteLegRow leg={leg({ connection_id: null })} {...baseProps} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("picking a life status calls updateConnection and shows a success message", async () => {
    vi.mocked(updateConnection).mockResolvedValue(connection());
    render(<RouteLegRow leg={leg()} {...baseProps} />);

    fireEvent.change(screen.getByDisplayValue("Mark time…"), {
      target: { value: "lt_4h" },
    });

    expect(updateConnection).toHaveBeenCalledWith(1, 1, {
      life_status: "lt_4h",
    });
    await waitFor(() =>
      expect(screen.getByText("Marked < 4h")).toBeInTheDocument(),
    );
  });

  it("picking a mass status calls updateConnection and shows a success message", async () => {
    vi.mocked(updateConnection).mockResolvedValue(connection());
    render(<RouteLegRow leg={leg()} {...baseProps} />);

    fireEvent.change(screen.getByDisplayValue("Mark mass…"), {
      target: { value: "fresh" },
    });

    expect(updateConnection).toHaveBeenCalledWith(1, 1, {
      mass_status: "fresh",
    });
    await waitFor(() =>
      expect(screen.getByText("Marked fresh")).toBeInTheDocument(),
    );
  });

  it("mark collapsed calls removeConnection directly when it succeeds", async () => {
    vi.mocked(removeConnection).mockResolvedValue(undefined);
    render(<RouteLegRow leg={leg()} {...baseProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Mark collapsed" }));

    expect(removeConnection).toHaveBeenCalledWith(1, 1);
    await waitFor(() =>
      expect(screen.getByText("Marked collapsed")).toBeInTheDocument(),
    );
  });

  it("falls back to flagging when the direct call 403s (no edit access)", async () => {
    vi.mocked(removeConnection).mockRejectedValue(
      new ApiError(403, "Forbidden"),
    );
    vi.mocked(createConnectionFlag).mockResolvedValue({
      id: 1,
      connection_id: 1,
      flagged_by_id: 1,
      flagged_by_name: "Someone",
      suggested_life_status: null,
      suggested_mass_status: null,
      suggests_collapsed: true,
      created_at: "2026-01-01T00:00:00Z",
    });
    render(<RouteLegRow leg={leg()} {...baseProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Mark collapsed" }));

    await waitFor(() =>
      expect(
        screen.getByText("Flagged for review by a map editor"),
      ).toBeInTheDocument(),
    );
    expect(createConnectionFlag).toHaveBeenCalledWith(1, {
      suggests_collapsed: true,
    });
  });

  it("falls back to flagging on a 404 too", async () => {
    vi.mocked(removeConnection).mockRejectedValue(
      new ApiError(404, "Not found"),
    );
    vi.mocked(createConnectionFlag).mockResolvedValue({
      id: 1,
      connection_id: 1,
      flagged_by_id: 1,
      flagged_by_name: "Someone",
      suggested_life_status: null,
      suggested_mass_status: null,
      suggests_collapsed: true,
      created_at: "2026-01-01T00:00:00Z",
    });
    render(<RouteLegRow leg={leg()} {...baseProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Mark collapsed" }));

    await waitFor(() =>
      expect(
        screen.getByText("Flagged for review by a map editor"),
      ).toBeInTheDocument(),
    );
  });

  it("shows the raw error for a non-403/404 failure, without falling back to a flag", async () => {
    vi.mocked(removeConnection).mockRejectedValue(
      new ApiError(500, "Server error"),
    );
    render(<RouteLegRow leg={leg()} {...baseProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Mark collapsed" }));

    await waitFor(() =>
      expect(screen.getByText(/Server error/)).toBeInTheDocument(),
    );
    expect(createConnectionFlag).not.toHaveBeenCalled();
  });

  it("shows the flag error if the fallback flag attempt also fails", async () => {
    vi.mocked(removeConnection).mockRejectedValue(
      new ApiError(403, "Forbidden"),
    );
    vi.mocked(createConnectionFlag).mockRejectedValue(new Error("flag failed"));
    render(<RouteLegRow leg={leg()} {...baseProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Mark collapsed" }));

    await waitFor(() =>
      expect(screen.getByText(/flag failed/)).toBeInTheDocument(),
    );
  });
});
