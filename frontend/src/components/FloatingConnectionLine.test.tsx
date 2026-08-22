import { render } from "@testing-library/react";
import type { ConnectionLineComponentProps, InternalNode } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { FloatingConnectionLine } from "./FloatingConnectionLine";

function fakeFromNode(
  x: number,
  y: number,
  width = 40,
  height = 40,
): InternalNode {
  return {
    measured: { width, height },
    internals: { positionAbsolute: { x, y } },
  } as unknown as InternalNode;
}

function connectionLineProps(
  overrides: Partial<ConnectionLineComponentProps>,
): ConnectionLineComponentProps {
  return {
    fromNode: undefined,
    toX: 0,
    toY: 0,
    fromX: 0,
    fromY: 0,
    fromPosition: "right",
    toPosition: "left",
    connectionLineType: "default",
    fromHandle: null,
    connectionStatus: null,
    toNode: undefined,
    ...overrides,
  } as unknown as ConnectionLineComponentProps;
}

describe("FloatingConnectionLine", () => {
  it("renders nothing when there's no source node yet", () => {
    const { container } = render(
      <svg>
        <FloatingConnectionLine
          {...connectionLineProps({ fromNode: undefined, toX: 100, toY: 100 })}
        />
      </svg>,
    );
    expect(container.querySelector("path")).not.toBeInTheDocument();
  });

  it("draws a path from the source node's center to the cursor position", () => {
    const { container } = render(
      <svg>
        <FloatingConnectionLine
          {...connectionLineProps({
            fromNode: fakeFromNode(0, 0, 40, 40),
            toX: 200,
            toY: 100,
          })}
        />
      </svg>,
    );

    // Source node center is (20, 20); path should start there.
    expect(container.querySelector("path")).toHaveAttribute(
      "d",
      expect.stringContaining("20,20"),
    );
    const circle = container.querySelector("circle");
    expect(circle).toHaveAttribute("cx", "200");
    expect(circle).toHaveAttribute("cy", "100");
  });
});
