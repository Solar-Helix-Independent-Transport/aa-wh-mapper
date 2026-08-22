import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RouteAlternateBanner } from "./RouteAlternateBanner";

describe("RouteAlternateBanner", () => {
  it("prompts to view the risky route when showing the safe one", () => {
    render(
      <RouteAlternateBanner showingAlternate={false} onToggle={vi.fn()} />,
    );

    expect(screen.getByText(/A shorter route exists/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "View risky route" }),
    ).toBeInTheDocument();
  });

  it("prompts to view the safe route when showing the alternate", () => {
    render(<RouteAlternateBanner showingAlternate={true} onToggle={vi.fn()} />);

    expect(screen.getByText(/Viewing a shorter route/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "View safe route" }),
    ).toBeInTheDocument();
  });

  it("applies the risky styling class only when showing the alternate", () => {
    const { container, rerender } = render(
      <RouteAlternateBanner showingAlternate={false} onToggle={vi.fn()} />,
    );
    expect(container.firstChild).not.toHaveClass(
      "route-alternate-banner-risky",
    );

    rerender(
      <RouteAlternateBanner showingAlternate={true} onToggle={vi.fn()} />,
    );
    expect(container.firstChild).toHaveClass("route-alternate-banner-risky");
  });

  it("calls onToggle when the button is clicked", () => {
    const onToggle = vi.fn();
    render(
      <RouteAlternateBanner showingAlternate={false} onToggle={onToggle} />,
    );

    fireEvent.click(screen.getByRole("button"));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
