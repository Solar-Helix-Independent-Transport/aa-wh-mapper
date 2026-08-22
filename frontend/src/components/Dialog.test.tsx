import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";

describe("Dialog", () => {
  it("renders its title and children", () => {
    render(
      <Dialog title="My Dialog" onClose={vi.fn()}>
        <p>Body content</p>
      </Dialog>,
    );

    expect(
      screen.getByRole("dialog", { name: "My Dialog" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Body content")).toBeInTheDocument();
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(
      <Dialog title="My Dialog" onClose={onClose}>
        <p>Body</p>
      </Dialog>,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the backdrop is clicked", () => {
    const onClose = vi.fn();
    render(
      <Dialog title="My Dialog" onClose={onClose}>
        <p>Body</p>
      </Dialog>,
    );

    fireEvent.click(screen.getByRole("dialog").parentElement!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when the dialog body itself is clicked", () => {
    const onClose = vi.fn();
    render(
      <Dialog title="My Dialog" onClose={onClose}>
        <p>Body</p>
      </Dialog>,
    );

    fireEvent.click(screen.getByRole("dialog"));

    expect(onClose).not.toHaveBeenCalled();
  });
});
