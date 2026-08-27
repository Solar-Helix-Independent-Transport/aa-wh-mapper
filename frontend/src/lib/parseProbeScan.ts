// Parses the tab-separated text EVE's in-game Scanner window produces when
// you select all probe scan results and copy them (Ctrl+A, Ctrl+C). Before a
// signature is fully scanned down, only its ID is known; once resolved, a
// "Group" column (e.g. "Wormhole", "Combat Site") appears alongside it - this
// lets the same paste be dropped in again later to upgrade already-known
// signatures in place instead of creating duplicates.
//
// Splits on runs of tabs OR 2+ spaces rather than a bare '\t': some paste
// paths (clipboard managers, terminal round-trips) expand tabs to spaces
// before they reach the browser. EVE's own names never contain 2+
// consecutive spaces, so this doesn't risk misreading a real column.
const COLUMN_SEPARATOR = /\t+| {2,}/;
const SIGNATURE_ID_PATTERN = /^[a-z0-9]{3}-\d{3}$/i;

const GROUP_TO_SIG_TYPE: Record<string, string> = {
  wormhole: "wormhole",
  "combat site": "combat",
  "data site": "data",
  "relic site": "relic",
  "gas site": "gas",
  "ore site": "ore",
};

export interface ParsedSignatureRow {
  signatureId: string;
  sigType?: string;
}

export function parseProbeScanPaste(
  text: string,
  // The five Drifter regions never spawn anything but wormholes - no
  // combat/data/relic/gas/ore sites exist there - so every signature pasted
  // into one, resolved or not, is classified as a wormhole outright rather
  // than falling back to "unknown" until someone scans it down. See
  // SignaturePanel's use of wormholeClass.ts's isDrifterWormholeClass.
  assumeWormhole = false,
): ParsedSignatureRow[] {
  const rows: ParsedSignatureRow[] = [];

  for (const line of text.split("\n")) {
    const columns = line.split(COLUMN_SEPARATOR).map((column) => column.trim());
    const signatureId = columns[0];
    if (!signatureId || !SIGNATURE_ID_PATTERN.test(signatureId)) {
      continue;
    }

    const sigType = assumeWormhole
      ? "wormhole"
      : columns
          .slice(1)
          .map((column) => GROUP_TO_SIG_TYPE[column.toLowerCase()])
          .find((value) => value !== undefined);

    rows.push({ signatureId: signatureId.toUpperCase(), sigType });
  }

  return rows;
}
