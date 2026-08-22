import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResizableSidePanel } from "./ResizableSidePanel";

describe("ResizableSidePanel", () => {
  it("renders only a show button when hidden", () => {
    render(
      <ResizableSidePanel
        width={300}
        hidden={true}
        onShow={vi.fn()}
        onHide={vi.fn()}
        onResizeStart={vi.fn()}
        label="Signatures"
      >
        <p>Panel content</p>
      </ResizableSidePanel>,
    );

    expect(
      screen.getByRole("button", { name: "Show Signatures" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Panel content")).not.toBeInTheDocument();
  });

  it("calls onShow when the show button is clicked", () => {
    const onShow = vi.fn();
    render(
      <ResizableSidePanel
        width={300}
        hidden={true}
        onShow={onShow}
        onHide={vi.fn()}
        onResizeStart={vi.fn()}
        label="Signatures"
      >
        <p>Panel content</p>
      </ResizableSidePanel>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show Signatures" }));
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it("renders its children, hide button, and resize handle at the given width when visible", () => {
    const { container } = render(
      <ResizableSidePanel
        width={420}
        hidden={false}
        onShow={vi.fn()}
        onHide={vi.fn()}
        onResizeStart={vi.fn()}
        label="Signatures"
      >
        <p>Panel content</p>
      </ResizableSidePanel>,
    );

    expect(screen.getByText("Panel content")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Hide Signatures" }),
    ).toBeInTheDocument();
    expect(container.querySelector(".resizable-panel-wrapper")).toHaveStyle({
      width: "420px",
    });
    expect(
      container.querySelector(".resizable-panel-resize-handle"),
    ).toBeInTheDocument();
  });

  it("calls onHide when the hide button is clicked", () => {
    const onHide = vi.fn();
    render(
      <ResizableSidePanel
        width={300}
        hidden={false}
        onShow={vi.fn()}
        onHide={onHide}
        onResizeStart={vi.fn()}
        label="Signatures"
      >
        <p>Panel content</p>
      </ResizableSidePanel>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Hide Signatures" }));
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it("calls onResizeStart on mouse down over the resize handle", () => {
    const onResizeStart = vi.fn();
    const { container } = render(
      <ResizableSidePanel
        width={300}
        hidden={false}
        onShow={vi.fn()}
        onHide={vi.fn()}
        onResizeStart={onResizeStart}
        label="Signatures"
      >
        <p>Panel content</p>
      </ResizableSidePanel>,
    );

    fireEvent.mouseDown(
      container.querySelector(".resizable-panel-resize-handle")!,
    );
    expect(onResizeStart).toHaveBeenCalledTimes(1);
  });
});
