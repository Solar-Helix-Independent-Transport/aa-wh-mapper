import { hierarchy, tree as d3Tree } from "d3-hierarchy";
import type { MapSystemOut, WormholeConnectionOut } from "../api/types";
import { SNAP_GRID } from "../constants";

// Distance along the chain's growth axis (hop distance from the root)
// between one depth level and the next - roughly a system node's own width
// (see .system-node's min/max-width in App.css) plus breathing room either
// side.
const DEPTH_SPACING = 220;
// Distance between two sibling systems at the same hop distance (the
// chain's cross axis).
const BREADTH_SPACING = 90;
// Gap left between two separately-packed connected components - a
// wormhole map is usually one connected chain, but a manually-added system
// with no connection yet (or two chains not yet linked) forms its own
// component.
const COMPONENT_MARGIN = 160;

interface TreeNode {
  id: number;
  children: TreeNode[];
}

interface Point {
  x: number;
  y: number;
}

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface SystemPosition {
  id: number;
  x: number;
  y: number;
}

function snap(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

function buildTree(id: number, childrenOf: Map<number, number[]>): TreeNode {
  return {
    id,
    children: (childrenOf.get(id) ?? []).map((childId) =>
      buildTree(childId, childrenOf),
    ),
  };
}

function boundsOf(points: Iterable<Point>): Bounds {
  const bounds = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  };
  for (const point of points) {
    bounds.minX = Math.min(bounds.minX, point.x);
    bounds.maxX = Math.max(bounds.maxX, point.x);
    bounds.minY = Math.min(bounds.minY, point.y);
    bounds.maxY = Math.max(bounds.maxY, point.y);
  }
  return bounds;
}

/** Lays out one connected component of the map as a tree radiating from
 * `rootId`, in the component's own local coordinate space (the root sits
 * whereever d3's tree layout puts it, not necessarily (0, 0)) - hop
 * distance from the root becomes the x axis, siblings at the same hop
 * distance stack along y. `childrenOf` is the component's BFS spanning
 * tree out of `rootId` (see computeAutoLayout) - a connection that isn't
 * part of that tree (a cycle back to an already-reached system) has no
 * home in a tree layout and is left for MapCanvas to draw between wherever
 * its two ends land, same as any other edge. */
function layoutComponentTree(
  rootId: number,
  childrenOf: Map<number, number[]>,
): Map<number, Point> {
  // The tree layout call mutates and returns the hierarchy with x/y filled
  // in (HierarchyPointNode) - iterating that return value directly, rather
  // than the pre-layout `root`, is what gives each node's x/y a definite
  // `number` type instead of the pre-layout `number | undefined`.
  const laidOut = d3Tree<TreeNode>().nodeSize([BREADTH_SPACING, DEPTH_SPACING])(
    hierarchy(buildTree(rootId, childrenOf)),
  );

  const positions = new Map<number, Point>();
  laidOut.each((node) => {
    // d3's tree x/y are its own breadth/depth axes - depth becomes this
    // layout's x (chain growth, left to right), breadth becomes y (sibling
    // stacking), matching how a WH chain is normally read.
    positions.set(node.data.id, { x: node.y, y: node.x });
  });
  return positions;
}

/** Finds a spot to place a component with no pinned anchor of its own -
 * stacks it below the lowest point of everything already placed. That
 * guarantees no overlap outright (this component's whole vertical extent
 * sits below every previously-placed box), without needing real bin
 * packing - simple, at the cost of being read top-to-bottom rather than
 * packed tightly, which is an acceptable trade for what's normally at most
 * a couple of stray components. */
function findFreeSpot(localBounds: Bounds, placed: Bounds[]): Point {
  if (placed.length === 0) {
    return { x: -localBounds.minX, y: -localBounds.minY };
  }
  const belowY = Math.max(...placed.map((box) => box.maxY)) + COMPONENT_MARGIN;
  return { x: -localBounds.minX, y: belowY - localBounds.minY };
}

/** Computes a clean, WH-mapping-style layout for a map's systems - see
 * MapView's "Auto-arrange" action. Each connected group of systems is laid
 * out as a tree radiating from one root (a pinned "home" system if the
 * group has one, otherwise its most-connected system), rather than left to
 * a generic force simulation to settle into whatever local minimum it
 * finds - a wormhole chain already reads as a tree in practice (occasional
 * cycle aside), and a deterministic tree layout can't produce the sprawling,
 * tangled result a physics-based layout sometimes does.
 *
 * A pinned system (MapSystem.pinned - see wh_mapper.models) never moves;
 * when it's the root of its component, that whole component is built and
 * anchored around its real position instead of an arbitrary origin. A
 * component with no pinned system of its own gets packed wherever
 * findFreeSpot lands it. Returns only the non-pinned systems, snapped to
 * the canvas's SNAP_GRID like every other placement path. */
export function computeAutoLayout(
  systems: MapSystemOut[],
  connections: WormholeConnectionOut[],
): SystemPosition[] {
  if (systems.length === 0) {
    return [];
  }

  const byId = new Map(systems.map((system) => [system.id, system]));
  const adjacency = new Map<number, Set<number>>();
  for (const system of systems) {
    adjacency.set(system.id, new Set());
  }
  for (const connection of connections) {
    const { top_system_id: a, bottom_system_id: b } = connection;
    if (a === b || !adjacency.has(a) || !adjacency.has(b)) {
      continue;
    }
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  }

  // Connected components, via a plain BFS over the whole graph - an
  // isolated system with no connections at all is its own trivial
  // component.
  const seen = new Set<number>();
  const components: number[][] = [];
  for (const system of systems) {
    if (seen.has(system.id)) {
      continue;
    }
    const componentIds: number[] = [];
    const queue = [system.id];
    seen.add(system.id);
    while (queue.length > 0) {
      const current = queue.shift()!;
      componentIds.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    components.push(componentIds);
  }

  interface LaidOutComponent {
    pinnedRootId: number | null;
    local: Map<number, Point>;
    bounds: Bounds;
  }

  const anchored: LaidOutComponent[] = [];
  const unanchored: LaidOutComponent[] = [];

  for (const componentIds of components) {
    const pinnedRootId =
      componentIds.find((id) => byId.get(id)!.pinned) ?? null;
    // With no pinned "home" to root on, the most-connected system reads
    // as the natural trunk of the chain - ties broken by id for a
    // deterministic result.
    const rootId =
      pinnedRootId ??
      componentIds.reduce((best, id) =>
        (adjacency.get(id)?.size ?? 0) > (adjacency.get(best)?.size ?? 0)
          ? id
          : best,
      );

    // BFS spanning tree from the root - each node's parent is the first
    // edge it's discovered through.
    const childrenOf = new Map<number, number[]>();
    for (const id of componentIds) {
      childrenOf.set(id, []);
    }
    const treeSeen = new Set([rootId]);
    const queue = [rootId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!treeSeen.has(neighbor)) {
          treeSeen.add(neighbor);
          childrenOf.get(current)!.push(neighbor);
          queue.push(neighbor);
        }
      }
    }

    const local = layoutComponentTree(rootId, childrenOf);
    const laidOut: LaidOutComponent = {
      pinnedRootId,
      local,
      bounds: boundsOf(local.values()),
    };
    (pinnedRootId === null ? unanchored : anchored).push(laidOut);
  }

  const positions = new Map<number, Point>();
  const placedBounds: Bounds[] = [];

  // Anchored components' placement is fixed (their root's real position),
  // so they're placed - and their bounds registered as obstacles - before
  // any unanchored component looks for a free spot.
  for (const { pinnedRootId, local, bounds } of anchored) {
    const anchor = byId.get(pinnedRootId!)!;
    const rootLocal = local.get(pinnedRootId!)!;
    const offset = { x: anchor.x - rootLocal.x, y: anchor.y - rootLocal.y };
    for (const [id, point] of local) {
      positions.set(id, { x: point.x + offset.x, y: point.y + offset.y });
    }
    placedBounds.push({
      minX: bounds.minX + offset.x - COMPONENT_MARGIN / 2,
      maxX: bounds.maxX + offset.x + COMPONENT_MARGIN / 2,
      minY: bounds.minY + offset.y - COMPONENT_MARGIN / 2,
      maxY: bounds.maxY + offset.y + COMPONENT_MARGIN / 2,
    });
  }

  for (const { local, bounds } of unanchored) {
    const offset = findFreeSpot(bounds, placedBounds);
    for (const [id, point] of local) {
      positions.set(id, { x: point.x + offset.x, y: point.y + offset.y });
    }
    placedBounds.push({
      minX: bounds.minX + offset.x - COMPONENT_MARGIN / 2,
      maxX: bounds.maxX + offset.x + COMPONENT_MARGIN / 2,
      minY: bounds.minY + offset.y - COMPONENT_MARGIN / 2,
      maxY: bounds.maxY + offset.y + COMPONENT_MARGIN / 2,
    });
  }

  const [gridX, gridY] = SNAP_GRID;
  return systems
    .filter((system) => !system.pinned)
    .map((system) => {
      const position = positions.get(system.id)!;
      return {
        id: system.id,
        x: snap(position.x, gridX),
        y: snap(position.y, gridY),
      };
    });
}
