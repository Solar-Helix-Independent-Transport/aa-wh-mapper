import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LoadingState } from "./LoadingState";

describe("LoadingState", () => {
  it("renders the given label", () => {
    render(<LoadingState label="Loading maps…" />);
    expect(screen.getByText("Loading maps…")).toBeInTheDocument();
  });
});
