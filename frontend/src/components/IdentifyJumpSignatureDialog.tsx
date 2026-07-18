import { useEffect, useState } from "react";
import {
  addSignature,
  linkConnectionSignature,
  listWormholeTypes,
  updateSignature,
} from "../api/maps";
import type {
  JumpNeedsSignaturePrompt,
  MapStateOut,
  WormholeTypeOut,
} from "../api/types";
import { JUMP_WORMHOLE_TYPE_DATALIST_ID } from "../constants";
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
// with no signature attached (see wh_mapper.tasks._grow_map_for_character) -
// asks which of the departure system's scanned signatures this was, and
// (if that signature's wormhole type isn't known yet) what type it is.
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
  const [newWhCode, setNewWhCode] = useState("");
  // Set once an existing, type-less signature has been picked and linked -
  // switches the dialog into a short follow-up step asking for its type.
  const [needsTypeFor, setNeedsTypeFor] = useState<number | null>(null);
  const [typeCode, setTypeCode] = useState("");

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

  const handlePickExisting = async (signatureId: number, hasType: boolean) => {
    try {
      await linkConnectionSignature(mapId, prompt.connection_id, signatureId);
      if (hasType) {
        onClose();
      } else {
        setNeedsTypeFor(signatureId);
      }
    } catch (err) {
      setError(String(err));
    }
  };

  const handleSaveType = async () => {
    if (needsTypeFor === null) {
      return;
    }
    try {
      if (typeCode.trim()) {
        await updateSignature(mapId, prompt.old_map_system_id, needsTypeFor, {
          wormhole_type_code: typeCode.trim(),
        });
      }
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
        wormhole_type_code: newWhCode.trim() || null,
      });
      await linkConnectionSignature(mapId, prompt.connection_id, created.id);
      onClose();
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <Dialog title="Which signature was that?" onClose={onClose}>
      <p className="dim">
        {prompt.character_name} jumped {oldSystemName} → {newSystemName} through
        a new wormhole.
      </p>
      {queueLength > 1 && (
        <p className="dim">
          {queueLength - 1} more jump{queueLength - 1 === 1 ? "" : "s"} waiting
        </p>
      )}

      {error && <p className="error">{error}</p>}

      {needsTypeFor !== null ? (
        <div className="dialog-section">
          <p className="dim">What type of wormhole was it (if you saw it)?</p>
          <input
            type="text"
            list={JUMP_WORMHOLE_TYPE_DATALIST_ID}
            placeholder="K162 (optional)"
            className="mono"
            autoFocus
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
          <div className="dialog-actions">
            <button
              type="button"
              className="button-primary"
              onClick={handleSaveType}
            >
              Save
            </button>
            <button type="button" className="link-button" onClick={onClose}>
              Skip
            </button>
          </div>
        </div>
      ) : (
        <>
          {candidates.length > 0 && (
            <div className="dialog-section">
              <p className="dim">Already scanned in {oldSystemName}</p>
              <ul className="search-results">
                {candidates.map((sig) => (
                  <SearchResultRow
                    key={sig.id}
                    onSelect={() =>
                      handlePickExisting(sig.id, Boolean(sig.wormhole_type))
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
              <input
                type="text"
                list={JUMP_WORMHOLE_TYPE_DATALIST_ID}
                placeholder="K162 (optional)"
                className="mono"
                value={newWhCode}
                onChange={(event) => setNewWhCode(event.target.value)}
              />
              <button type="submit">Add &amp; link</button>
            </form>
          </div>

          <button type="button" className="link-button" onClick={onClose}>
            Skip - I'll link it later
          </button>
        </>
      )}
    </Dialog>
  );
}
