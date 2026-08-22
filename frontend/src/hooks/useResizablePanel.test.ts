import { act, renderHook } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useResizablePanel } from "./useResizablePanel";

const OPTIONS = {
  defaultWidth: 300,
  minWidth: 200,
  maxWidth: 500,
  widthStorageKey: "test-width",
  hiddenStorageKey: "test-hidden",
};

function fakeMouseEvent(clientX: number) {
  return { preventDefault: vi.fn(), clientX } as unknown as ReactMouseEvent;
}

describe("useResizablePanel", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts at defaultWidth when nothing is stored", () => {
    const { result } = renderHook(() => useResizablePanel(OPTIONS));
    expect(result.current.width).toBe(300);
    expect(result.current.hidden).toBe(false);
  });

  it("restores a previously-stored width within bounds", () => {
    localStorage.setItem(OPTIONS.widthStorageKey, "350");
    const { result } = renderHook(() => useResizablePanel(OPTIONS));
    expect(result.current.width).toBe(350);
  });

  it("ignores a stored width outside min/max bounds", () => {
    localStorage.setItem(OPTIONS.widthStorageKey, "50");
    const { result } = renderHook(() => useResizablePanel(OPTIONS));
    expect(result.current.width).toBe(300);
  });

  it("restores a previously-stored hidden flag", () => {
    localStorage.setItem(OPTIONS.hiddenStorageKey, "true");
    const { result } = renderHook(() => useResizablePanel(OPTIONS));
    expect(result.current.hidden).toBe(true);
  });

  it("persists width changes to localStorage", () => {
    const { result } = renderHook(() => useResizablePanel(OPTIONS));

    act(() => {
      result.current.handleResizeStart(fakeMouseEvent(500));
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 450 }));
    });

    // Dragging left by 50px (500 -> 450) grows the right-edge panel by 50.
    expect(result.current.width).toBe(350);
    expect(localStorage.getItem(OPTIONS.widthStorageKey)).toBe("350");
  });

  it("clamps the width to maxWidth while dragging", () => {
    const { result } = renderHook(() => useResizablePanel(OPTIONS));

    act(() => {
      result.current.handleResizeStart(fakeMouseEvent(500));
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 0 }));
    });

    expect(result.current.width).toBe(500);
  });

  it("clamps the width to minWidth while dragging", () => {
    const { result } = renderHook(() => useResizablePanel(OPTIONS));

    act(() => {
      result.current.handleResizeStart(fakeMouseEvent(0));
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 500 }));
    });

    expect(result.current.width).toBe(200);
  });

  it("stops resizing on mouseup and ignores further mousemoves", () => {
    const { result } = renderHook(() => useResizablePanel(OPTIONS));

    act(() => {
      result.current.handleResizeStart(fakeMouseEvent(500));
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 450 }));
      document.dispatchEvent(new MouseEvent("mouseup"));
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 0 }));
    });

    expect(result.current.width).toBe(350);
  });

  it("persists hidden-state changes to localStorage", () => {
    const { result } = renderHook(() => useResizablePanel(OPTIONS));

    act(() => {
      result.current.setHidden(true);
    });

    expect(result.current.hidden).toBe(true);
    expect(localStorage.getItem(OPTIONS.hiddenStorageKey)).toBe("true");
  });

  it("tears down an in-progress drag's listeners on unmount", () => {
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const { result, unmount } = renderHook(() => useResizablePanel(OPTIONS));

    act(() => {
      result.current.handleResizeStart(fakeMouseEvent(500));
    });
    unmount();

    expect(removeSpy).toHaveBeenCalledWith("mousemove", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("mouseup", expect.any(Function));
  });
});
