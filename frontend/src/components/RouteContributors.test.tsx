import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RouteContributors } from "./RouteContributors";

describe("RouteContributors", () => {
  it("renders nothing for an empty contributor list", () => {
    const { container } = render(<RouteContributors contributors={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists each contributor with their contribution count", () => {
    render(
      <RouteContributors
        contributors={[
          { character_id: 1, name: "Alice", contribution_count: 3 },
          { character_id: 2, name: "Bob", contribution_count: 1 },
        ]}
      />,
    );

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("×3")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("×1")).toBeInTheDocument();
  });

  it("keys a contributor with no character_id by name", () => {
    render(
      <RouteContributors
        contributors={[
          { character_id: null, name: "Unknown", contribution_count: 1 },
        ]}
      />,
    );

    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });
});
