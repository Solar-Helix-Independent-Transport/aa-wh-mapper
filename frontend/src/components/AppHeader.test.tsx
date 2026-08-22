import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppHeader } from "./AppHeader";

// TrackedCharactersPanel does its own API fetching on mount - out of scope
// for AppHeader's own tests (which only care whether it renders when
// toggled), and it has its own dedicated test file.
vi.mock("./TrackedCharactersPanel", () => ({
  TrackedCharactersPanel: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="tracked-characters-panel">
      <button type="button" onClick={onClose}>
        close panel
      </button>
    </div>
  ),
}));

function renderHeader(
  props: ComponentProps<typeof AppHeader> = {},
  path = "/",
) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppHeader {...props} />
    </MemoryRouter>,
  );
}

describe("AppHeader", () => {
  it("renders the brand and nav links", () => {
    renderHeader();
    expect(screen.getByRole("link", { name: "Maps" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Navigate" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Status" })).toBeInTheDocument();
  });

  it("marks the Maps link active on both / and /maps/:id", () => {
    renderHeader({}, "/maps/5");
    expect(screen.getByRole("link", { name: "Maps" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("marks Navigate active by prefix, e.g. /route/shared/9", () => {
    renderHeader({}, "/route/shared/9");
    expect(screen.getByRole("link", { name: "Navigate" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Maps" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("shows the page title when given one", () => {
    renderHeader({ title: "My Map" });
    expect(screen.getByRole("heading", { name: "My Map" })).toBeInTheDocument();
  });

  it("renders no title heading when none is given", () => {
    renderHeader();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("renders page-specific actions in the context zone", () => {
    renderHeader({ actions: <button type="button">+ Add system</button> });
    expect(
      screen.getByRole("button", { name: "+ Add system" }),
    ).toBeInTheDocument();
  });

  it("shows no tracked-character count badge when none is given", () => {
    renderHeader();
    expect(
      screen.getByRole("button", { name: "Tracked characters" }),
    ).toBeInTheDocument();
  });

  it("shows the tracked-character count badge when given one", () => {
    renderHeader({ trackedCharacterCount: 3 });
    expect(
      screen.getByRole("button", { name: "Tracked characters (3)" }),
    ).toBeInTheDocument();
  });

  it("opens the tracked characters panel on click", () => {
    renderHeader();
    expect(
      screen.queryByTestId("tracked-characters-panel"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tracked characters" }));

    expect(screen.getByTestId("tracked-characters-panel")).toBeInTheDocument();
  });

  it("closes the tracked characters panel", () => {
    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Tracked characters" }));
    fireEvent.click(screen.getByRole("button", { name: "close panel" }));

    expect(
      screen.queryByTestId("tracked-characters-panel"),
    ).not.toBeInTheDocument();
  });

  it("hides the overflow button when there are no overflow items", () => {
    renderHeader();
    expect(screen.queryByTitle("More actions")).not.toBeInTheDocument();
  });

  it("hides the overflow button when overflowItems is an empty array", () => {
    renderHeader({ overflowItems: [] });
    expect(screen.queryByTitle("More actions")).not.toBeInTheDocument();
  });

  it("opens the overflow context menu with the given items", () => {
    renderHeader({
      overflowItems: [
        { kind: "action", label: "Import region", onClick: vi.fn() },
      ],
    });

    // The overflow button's accessible name is its "⋯" text content - only
    // its title attribute reads "More actions" (tooltip-only).
    fireEvent.click(screen.getByTitle("More actions"));

    expect(
      screen.getByRole("button", { name: "Import region" }),
    ).toBeInTheDocument();
  });
});
