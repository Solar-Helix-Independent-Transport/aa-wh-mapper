import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchResultRow } from "./SearchResultRow";

describe("SearchResultRow", () => {
  it("is a focusable button-role list item", () => {
    render(<SearchResultRow onSelect={vi.fn()}>Jita</SearchResultRow>);
    const row = screen.getByRole("button", { name: "Jita" });
    expect(row.tagName).toBe("LI");
    expect(row).toHaveAttribute("tabIndex", "0");
  });

  it("calls onSelect on click", () => {
    const onSelect = vi.fn();
    render(<SearchResultRow onSelect={onSelect}>Jita</SearchResultRow>);
    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("calls onSelect on Enter", () => {
    const onSelect = vi.fn();
    render(<SearchResultRow onSelect={onSelect}>Jita</SearchResultRow>);
    fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("calls onSelect on Space", () => {
    const onSelect = vi.fn();
    render(<SearchResultRow onSelect={onSelect}>Jita</SearchResultRow>);
    fireEvent.keyDown(screen.getByRole("button"), { key: " " });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("ignores other keys", () => {
    const onSelect = vi.fn();
    render(<SearchResultRow onSelect={onSelect}>Jita</SearchResultRow>);
    fireEvent.keyDown(screen.getByRole("button"), { key: "Tab" });
    expect(onSelect).not.toHaveBeenCalled();
  });
});
