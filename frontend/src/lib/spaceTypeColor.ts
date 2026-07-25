// Same hex values as the map's .space-* CSS classes (App.css) and
// MapLegend's SPACE_SWATCHES - kept as a plain color lookup (rather than
// reusing those classes directly) since they also carry a background,
// meant for SystemNode's titlebar strip, not inline text elsewhere.
const SPACE_TYPE_COLOR: Record<string, string> = {
  "High Sec": "#4ade80",
  "Low Sec": "#ffb454",
  "Null Sec": "#ff5c7a",
  Wormhole: "#a68cff",
  Pochven: "#ff8cf0",
  "Abyssal Deadspace": "#ff8cf0",
};

export function spaceTypeColor(spaceType: string): string {
  return SPACE_TYPE_COLOR[spaceType] ?? "var(--text-dim)";
}
