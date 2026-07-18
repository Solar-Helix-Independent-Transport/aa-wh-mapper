import { NEW_SYSTEM_SPACING_X, NEW_SYSTEM_SPACING_Y } from "../constants";

// Places a newly-added system to the right of the current chain instead of
// dropping it at a random spot, which used to scatter new systems on top of
// existing ones with no relation to the rest of the map.
export function nextPosition(existingSystems: { x: number; y: number }[]) {
  if (existingSystems.length === 0) {
    return { x: 0, y: 0 };
  }
  const maxX = Math.max(...existingSystems.map((s) => s.x));
  const avgY =
    existingSystems.reduce((sum, s) => sum + s.y, 0) / existingSystems.length;
  return {
    x: maxX + NEW_SYSTEM_SPACING_X,
    y: avgY + (Math.random() - 0.5) * NEW_SYSTEM_SPACING_Y,
  };
}
