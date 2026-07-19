import { useEffect, useState } from "react";
import {
  addSignature,
  linkConnectionSignature,
  listWormholeTypes,
  updateConnection,
  updateSignature,
} from "../api/maps";
import type {
  JumpNeedsSignaturePrompt,
  MapStateOut,
  WormholeTypeOut,
} from "../api/types";
import {
  JUMP_WORMHOLE_TYPE_DATALIST_ID,
  LIFE_STATUS_LABEL,
  LIFE_STATUSES,
  MASS_STATUSES,
} from "../constants";
import { Dialog } from "./Dialog";
import { SearchResultRow } from "./SearchResultRow";
import {
  wormholeTypeDatalistOptions,
  wormholeTypeSummary,
} from "./wormholeClass";

interface Props {
  mapId: number;
  state: MapStateOut;
  prompt: JumpNeedsSignaturePrompt;
  // Size of the pending queue including this prompt - several characters
  // (or one jumping several wormholes in a row) can each queue one up
  // before the viewer gets to answer the first.
  queueLength: number;
  onClose: () => void;
}

// Shown when a tracked character's jump auto-creates a wormhole connection
// with no signature attached (see wh_mapper.tasks._grow_map_for_character),
// or when the viewer reopens one of those still-unidentified connections
// later from the map's "Pending signatures" button (MapView's
// reopenPendingSignatures) - prompt.character_name is null in that case.
// Asks which of the departure system's scanned signatures this was, and
// (via the shared "Wormhole details" section) what its type/mass/life state
// is, if known.
export function IdentifyJumpSignatureDialog({
  mapId,
  state,
  prompt,
  queueLength,
  onClose,
}: Props) {
  const [wormholeTypes, setWormholeTypes] = useState<WormholeTypeOut[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newSigId, setNewSigId] = useState("");
  // Type/mass/life all describe the same physical wormhole, so one shared
  // set of fields (shown above the sig selection) feeds whichever path -
  // picking an existing signature or adding a new one - the user takes.
  const [typeCode, setTypeCode] = useState("");
  // A jump always disturbs the wormhole's mass at least a little, so default
  // to "reduced" rather than the connection's own "unknown" default - saves
  // a trip to the SignaturePanel for the common case.
  const [massStatus, setMassStatus] = useState("reduced");
  const [lifeStatus, setLifeStatus] = useState("stable");

  useEffect(() => {
    listWormholeTypes()
      .then(setWormholeTypes)
      .catch((err) => setError(String(err)));
  }, []);

  const oldSystem = state.systems.find(
    (s) => s.id === prompt.old_map_system_id,
  );
  const newSystem = state.systems.find(
    (s) => s.id === prompt.new_map_system_id,
  );
  const oldSystemName =
    oldSystem?.label ||
    oldSystem?.solar_system.name ||
    `#${prompt.old_map_system_id}`;
  const newSystemName =
    newSystem?.label ||
    newSystem?.solar_system.name ||
    `#${prompt.new_map_system_id}`;

  // Copies "SIG-ID - System - Region" for the destination system to the
  // clipboard once a signature is linked, so it can be pasted straight into
  // corp/fleet chat without retyping.
  const copySignatureSummary = (signatureId: string) => {
    const systemName = newSystem?.solar_system.name || newSystemName;
    const regionName = newSystem?.solar_system.region_name;
    const summary = regionName
      ? `${signatureId} - ${systemName} - ${regionName}`
      : `${signatureId} - ${systemName}`;
    navigator.clipboard.writeText(summary).catch(() => {});
  };

  const linkedSignatureIds = new Set(
    state.connections
      .flatMap((c) => [c.top_signature_id, c.bottom_signature_id])
      .filter((id) => id !== null),
  );
  const candidates = state.signatures.filter(
    (s) =>
      s.map_system_id === prompt.old_map_system_id &&
      s.sig_type === "wormhole" &&
      !s.is_hidden &&
      !linkedSignatureIds.has(s.id),
  );

  const handlePickExisting = async (
    signatureId: number,
    signatureCode: string,
    hasType: boolean,
  ) => {
    try {
      await linkConnectionSignature(mapId, prompt.connection_id, signatureId);
      await updateConnection(mapId, prompt.connection_id, {
        mass_status: massStatus,
        life_status: lifeStatus,
      });
      // Never overwrite a type the signature already had - the shared field
      // only fills in a type that isn't known yet.
      if (!hasType && typeCode.trim()) {
        await updateSignature(mapId, prompt.old_map_system_id, signatureId, {
          wormhole_type_code: typeCode.trim(),
        });
      }
      copySignatureSummary(signatureCode);
      onClose();
    } catch (err) {
      setError(String(err));
    }
  };

  // A jump bridge produces the exact same undetectable-by-ESI blind
  // connection as a real wormhole (see _grow_map_for_character), so this
  // dialog can't tell them apart up front - this lets the viewer correct
  // it. No signature applies to an Ansiblex, so this just retags the
  // connection and closes the prompt.
  const handleMarkAnsiblex = async () => {
    try {
      await updateConnection(mapId, prompt.connection_id, {
        connection_type: "ansiblex",
      });
      onClose();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleAddNew = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newSigId.trim()) {
      return;
    }
    try {
      const created = await addSignature(mapId, prompt.old_map_system_id, {
        signature_id: newSigId.trim().toUpperCase(),
        sig_type: "wormhole",
        wormhole_type_code: typeCode.trim() || null,
      });
      await linkConnectionSignature(mapId, prompt.connection_id, created.id);
      await updateConnection(mapId, prompt.connection_id, {
        mass_status: massStatus,
        life_status: lifeStatus,
      });
      copySignatureSummary(created.signature_id);
      onClose();
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <Dialog title="Which signature was that?" onClose={onClose}>
      <p className="dim">
        {prompt.character_name ? (
          <>
            {prompt.character_name} jumped {oldSystemName} → {newSystemName}{" "}
            through a new wormhole.
          </>
        ) : (
          <>
            {oldSystemName} → {newSystemName} - wormhole connection still needs
            a signature.
          </>
        )}
      </p>
      {queueLength > 1 && (
        <p className="dim">
          {queueLength - 1} more jump{queueLength - 1 === 1 ? "" : "s"} waiting
        </p>
      )}

      {error && <p className="error">{error}</p>}

      <button
        type="button"
        className="link-button"
        title="No signature needed for a jump bridge - this just retags the connection and closes the prompt"
        onClick={handleMarkAnsiblex}
      >
        Actually, this was a jump bridge (Ansiblex)
      </button>

      <div className="dialog-section">
        <p className="dim">Wormhole details (if known)</p>
        <div className="entry-row-controls">
          <input
            type="text"
            list={JUMP_WORMHOLE_TYPE_DATALIST_ID}
            placeholder="K162 (type, optional)"
            className="mono"
            value={typeCode}
            onChange={(event) => setTypeCode(event.target.value)}
          />
          <datalist id={JUMP_WORMHOLE_TYPE_DATALIST_ID}>
            {wormholeTypeDatalistOptions(wormholeTypes).map((wt) => (
              <option
                key={wt.code}
                value={wt.code}
                label={wormholeTypeSummary(wt)}
              />
            ))}
          </datalist>
          <select
            value={massStatus}
            onChange={(event) => setMassStatus(event.target.value)}
          >
            {MASS_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={lifeStatus}
            onChange={(event) => setLifeStatus(event.target.value)}
          >
            {LIFE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LIFE_STATUS_LABEL[s] ?? s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {candidates.length > 0 && (
        <div className="dialog-section">
          <p className="dim">Already scanned in {oldSystemName}</p>
          <ul className="search-results">
            {candidates.map((sig) => (
              <SearchResultRow
                key={sig.id}
                onSelect={() =>
                  handlePickExisting(
                    sig.id,
                    sig.signature_id,
                    Boolean(sig.wormhole_type),
                  )
                }
              >
                <span className="mono">{sig.signature_id}</span>
                {sig.wormhole_type
                  ? ` — ${sig.wormhole_type.code}`
                  : " — type unknown"}
              </SearchResultRow>
            ))}
          </ul>
        </div>
      )}

      <div className="dialog-section">
        <p className="dim">Or a new signature</p>
        <form className="add-signature-form" onSubmit={handleAddNew}>
          <input
            type="text"
            placeholder="ABC-123"
            className="mono"
            maxLength={7}
            value={newSigId}
            onChange={(event) => setNewSigId(event.target.value)}
          />
          <button type="submit">Add &amp; link</button>
        </form>
      </div>

      <button type="button" className="link-button" onClick={onClose}>
        Skip - I'll link it later
      </button>
    </Dialog>
  );
}
