import { fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { MapLegend } from "./MapLegend";

function renderLegend() {
  return render(<MapLegend />, { wrapper: ReactFlowProvider });
}

describe("MapLegend", () => {
  it("starts closed", () => {
    renderLegend();
    expect(screen.queryByText("Systems")).not.toBeInTheDocument();
  });

  it("opens the popover on click and shows both sections", () => {
    renderLegend();
    fireEvent.click(screen.getByRole("button", { name: "Legend" }));

    expect(screen.getByText("Systems")).toBeInTheDocument();
    expect(screen.getByText("Connections")).toBeInTheDocument();
    expect(screen.getByText("Stargate")).toBeInTheDocument();
  });

  it("toggles closed on a second click", () => {
    renderLegend();
    const button = screen.getByRole("button", { name: "Legend" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(screen.queryByText("Systems")).not.toBeInTheDocument();
  });

  it("closes when clicking outside the popover", () => {
    renderLegend();
    fireEvent.click(screen.getByRole("button", { name: "Legend" }));
    expect(screen.getByText("Systems")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByText("Systems")).not.toBeInTheDocument();
  });

  it("does not close when clicking inside the popover", () => {
    renderLegend();
    fireEvent.click(screen.getByRole("button", { name: "Legend" }));

    fireEvent.mouseDown(screen.getByText("Systems"));

    expect(screen.getByText("Systems")).toBeInTheDocument();
  });
});
