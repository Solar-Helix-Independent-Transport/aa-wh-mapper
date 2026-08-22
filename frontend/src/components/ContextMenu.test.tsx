import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

describe("ContextMenu", () => {
  it("renders action items and fires onClick + onClose together", () => {
    const onClick = vi.fn();
    const onClose = vi.fn();
    const items: ContextMenuItem[] = [
      { kind: "action", label: "Do thing", onClick },
    ];
    render(<ContextMenu x={10} y={10} items={items} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Do thing" }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders a disabled action item as a disabled button that does nothing on click", () => {
    const onClick = vi.fn();
    const onClose = vi.fn();
    const items: ContextMenuItem[] = [
      { kind: "action", label: "Can't do this", onClick, disabled: true },
    ];
    render(<ContextMenu x={0} y={0} items={items} onClose={onClose} />);

    const button = screen.getByRole("button", { name: "Can't do this" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("marks a danger item with the danger class", () => {
    const items: ContextMenuItem[] = [
      { kind: "action", label: "Delete", onClick: vi.fn(), danger: true },
    ];
    render(<ContextMenu x={0} y={0} items={items} onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Delete" })).toHaveClass(
      "danger",
    );
  });

  it("renders a separator with no interactive role", () => {
    const items: ContextMenuItem[] = [
      { kind: "action", label: "One", onClick: vi.fn() },
      { kind: "separator" },
      { kind: "action", label: "Two", onClick: vi.fn() },
    ];
    render(<ContextMenu x={0} y={0} items={items} onClose={vi.fn()} />);

    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("opens a submenu on hover and closes it on mouse leave", () => {
    const items: ContextMenuItem[] = [
      {
        kind: "submenu",
        label: "More",
        items: [{ kind: "action", label: "Nested", onClick: vi.fn() }],
      },
    ];
    render(<ContextMenu x={0} y={0} items={items} onClose={vi.fn()} />);

    expect(
      screen.queryByRole("button", { name: "Nested" }),
    ).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByText("More").closest("li")!);
    expect(screen.getByRole("button", { name: "Nested" })).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByText("More").closest("li")!);
    expect(
      screen.queryByRole("button", { name: "Nested" }),
    ).not.toBeInTheDocument();
  });

  it("calls onClose when clicking outside the menu", () => {
    const onClose = vi.fn();
    render(<ContextMenu x={0} y={0} items={[]} onClose={onClose} />);

    fireEvent.mouseDown(document.body);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when clicking inside the menu", () => {
    const onClose = vi.fn();
    const items: ContextMenuItem[] = [
      { kind: "action", label: "One", onClick: vi.fn() },
    ];
    render(<ContextMenu x={0} y={0} items={items} onClose={onClose} />);

    fireEvent.mouseDown(screen.getByRole("button", { name: "One" }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(<ContextMenu x={0} y={0} items={[]} onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on window scroll or resize", () => {
    const onClose = vi.fn();
    render(<ContextMenu x={0} y={0} items={[]} onClose={onClose} />);

    fireEvent.scroll(window);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent(window, new Event("resize"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("removes its document/window listeners on unmount", () => {
    const removeDocSpy = vi.spyOn(document, "removeEventListener");
    const removeWinSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(
      <ContextMenu x={0} y={0} items={[]} onClose={vi.fn()} />,
    );

    unmount();

    expect(removeDocSpy).toHaveBeenCalledWith(
      "mousedown",
      expect.any(Function),
      true,
    );
    expect(removeDocSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
    expect(removeWinSpy).toHaveBeenCalledWith(
      "scroll",
      expect.any(Function),
      true,
    );
    expect(removeWinSpy).toHaveBeenCalledWith("resize", expect.any(Function));
  });
});
