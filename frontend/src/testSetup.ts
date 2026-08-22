import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// vite.config's `test` block doesn't set `globals: true` (keeping
// describe/it/expect explicit imports everywhere), so @testing-library/react's
// own auto-cleanup - which hooks a global `afterEach` - never registers.
// Without this, unmounted components from a previous test stay in the DOM
// and leak into the next test's queries.
afterEach(() => cleanup());

// jsdom has no layout engine and no ResizeObserver, but @xyflow/react's node
// measuring relies on one to report each node's rendered size - without a
// stub, mounting any ReactFlow tree (MapCanvas, UniverseRegionsDialog) throws
// "ResizeObserver is not defined".
//
// This stub deliberately never calls back (a real callback needs
// window.DOMMatrixReadOnly, which jsdom also lacks, and even polyfilling
// that still leaves xyflow's nodes stuck "unmeasured" in this environment) -
// which means xyflow never considers a node "measured", and so never renders
// any edge connected to it (confirmed empirically: .react-flow__edges stays
// permanently empty here). Nodes themselves still render fine. Tests that
// need to assert on rendered edges/edge interactions aren't achievable
// against this stub - see FloatingEdge.tsx and RouteDiagram.tsx's own test
// files for what's covered instead (geometry math directly, node-only
// interactions).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??=
  ResizeObserverStub;

// Node 22+'s own built-in `localStorage` global (file-backed, distinct from
// jsdom's in-memory Storage) shadows jsdom's if the process wasn't started
// with `--no-experimental-webstorage` - see package.json's test scripts.
// Without that flag, Node's own version wins here and it's a non-functional
// stub with no valid backing file, so `localStorage.clear()` etc. throw
// "is not a function" in any test/hook that touches localStorage
// (useResizablePanel, etc.).
