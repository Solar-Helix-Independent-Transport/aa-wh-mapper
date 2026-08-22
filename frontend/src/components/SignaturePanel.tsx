import { useEffect, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import {
  addSignature,
  bulkUpsertSignatures,
  linkConnectionSignature,
  listWormholeTypes,
  removeConnection,
  removeSignature,
  removeSystem,
  updateConnection,
  updateSignature,
  updateSystem,
} from "../api/maps";
import type {
  ConnectionType,
  MapStateOut,
  MapSystemOut,
  WormholeTypeOut,
} from "../api/types";
import {
  CONNECTION_TYPES,
  LIFE_STATUS_CHECK_INTERVAL_MS,
  LIFE_STATUS_LABEL,
  LIFE_STATUSES,
  MASS_STATUSES,
  SHIP_SIZE_LABEL,
  SHIP_SIZE_LIMITS,
  SIG_TYPES,
  SYSTEM_FINDER_DATALIST_ID,
  WORMHOLE_TYPE_DATALIST_ID,
} from "../constants";
import { useNow } from "../hooks/useNow";
import { parseProbeScanPaste } from "../lib/parseProbeScan";
import { ConnectSignatureDialog } from "./ConnectSignatureDialog";
import {
  connectionWormholeType,
  effectiveLifeStatus,
  shipSizeForJumpMass,
  wormholeTypeDatalistOptions,
  wormholeTypeSummary,
} from "./wormholeClass";

interface Props {
  mapId: number;
  state: MapStateOut;
  systemId: number | null;
  onClose: () => void;
  onSelectSystem: (systemId: number | null) => void;
  onSystemCreated: (system: MapSystemOut) => void;
  // A read-only reference map (see wh_mapper.models.Map.read_only) - every
  // add/edit/delete control is disabled or hidden; the list itself stays
  // fully visible.
  readOnly?: boolean;
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function SignaturePanel({
  mapId,
  state,
  systemId,
  onClose,
  onSelectSystem,
  onSystemCreated,
  readOnly = false,
}: Props) {
  const now = useNow(LIFE_STATUS_CHECK_INTERVAL_MS);
  const [newSigId, setNewSigId] = useState("");
  const [newSigType, setNewSigType] = useState("wormhole");
  const [newWhCode, setNewWhCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [finderQuery, setFinderQuery] = useState("");
  const [wormholeTypes, setWormholeTypes] = useState<WormholeTypeOut[]>([]);
  const [pasteText, setPasteText] = useState("");
  const [pasteMessage, setPasteMessage] = useState<string | null>(null);
  const [lazyDelete, setLazyDelete] = useState(false);
  const [removeDanglingSystems, setRemoveDanglingSystems] = useState(false);
  const [connectSignatureId, setConnectSignatureId] = useState<number | null>(
    null,
  );
  // Default to showing only wormhole/unknown signatures - combat/data/relic/
  // gas/ore sites are rarely what you're scanning down mid-chain, so they
  // start filtered out rather than cluttering the list.
  const [hiddenSigTypes, setHiddenSigTypes] = useState<Set<string>>(
    new Set(SIG_TYPES.filter((t) => t !== "wormhole" && t !== "unknown")),
  );
  // Individually-hidden signatures (sig.is_hidden, persisted) are excluded
  // by default too, on top of the whole-type filter above - this reveals
  // them again without having to un-hide each one just to find it.
  const [showHidden, setShowHidden] = useState(false);
  const [sigSearch, setSigSearch] = useState("");
  const [typeFilterOpen, setTypeFilterOpen] = useState(false);
  const typeFilterRef = useRef<HTMLDivElement>(null);
  const { getNode, setCenter, getZoom } = useReactFlow();

  useEffect(() => {
    listWormholeTypes()
      .then(setWormholeTypes)
      .catch((err) => setError(String(err)));
  }, []);

  useEffect(() => {
    if (!typeFilterOpen) {
      return;
    }
    const handleClickOutside = (event: MouseEvent) => {
      if (
        typeFilterRef.current &&
        !typeFilterRef.current.contains(event.target as Node)
      ) {
        setTypeFilterOpen(false);
      }
    };
    // Capture phase, not bubble: react-flow's pane handles mousedown itself
    // (for box-select/panning) and stops it from bubbling, so a bubble-phase
    // document listener never sees a click on the canvas itself - see the
    // same pattern in ContextMenu.tsx/MapLegend.tsx.
    document.addEventListener("mousedown", handleClickOutside, true);
    return () =>
      document.removeEventListener("mousedown", handleClickOutside, true);
  }, [typeFilterOpen]);

  const system =
    systemId === null
      ? undefined
      : state.systems.find((s) => s.id === systemId);

  const centerOnSystem = (id: number) => {
    const node = getNode(String(id));
    if (!node) {
      return;
    }
    const width = node.measured?.width ?? 0;
    const height = node.measured?.height ?? 0;
    setCenter(node.position.x + width / 2, node.position.y + height / 2, {
      zoom: getZoom(),
      duration: 400,
    });
  };

  const handleFinderChange = (value: string) => {
    setFinderQuery(value);
    const match = state.systems.find(
      (s) =>
        (s.label || s.solar_system.name).toLowerCase() ===
        value.trim().toLowerCase(),
    );
    if (!match) {
      return;
    }
    onSelectSystem(match.id);
    centerOnSystem(match.id);
    setFinderQuery("");
  };

  const finder = (
    <div className="system-finder">
      <input
        type="text"
        list={SYSTEM_FINDER_DATALIST_ID}
        placeholder="Find a system…"
        value={finderQuery}
        onChange={(event) => handleFinderChange(event.target.value)}
      />
      <datalist id={SYSTEM_FINDER_DATALIST_ID}>
        {state.systems
          .slice()
          .sort((a, b) =>
            (a.label || a.solar_system.name).localeCompare(
              b.label || b.solar_system.name,
            ),
          )
          .map((s) => (
            <option key={s.id} value={s.label || s.solar_system.name} />
          ))}
      </datalist>
    </div>
  );

  if (!system) {
    return (
      <aside className="signature-panel">
        {finder}
        <div className="signature-panel-empty-message">
          <p className="dim">Select a system for details.</p>
        </div>
      </aside>
    );
  }

  // `system` is narrowed to non-null here, but that narrowing doesn't persist
  // into the closures below (TS re-widens captured variables inside function
  // expressions) - use this instead of `systemId` there.
  const currentSystemId = system.id;
  const signatures = state.signatures.filter(
    (s) => s.map_system_id === currentSystemId,
  );
  const connections = state.connections.filter(
    (c) =>
      c.top_system_id === currentSystemId ||
      c.bottom_system_id === currentSystemId,
  );

  const systemName = (id: number) =>
    state.systems.find((s) => s.id === id)?.solar_system.name ?? `#${id}`;

  const otherSystemId = (connection: MapStateOut["connections"][number]) =>
    connection.top_system_id === currentSystemId
      ? connection.bottom_system_id
      : connection.top_system_id;

  const toggleSigTypeVisible = (type: string) => {
    setHiddenSigTypes((current) => {
      const next = new Set(current);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const sigSearchQuery = sigSearch.trim().toLowerCase();
  const visibleSignatures = signatures
    .filter((sig) => {
      if (sig.is_hidden && !showHidden) {
        return false;
      }
      if (hiddenSigTypes.has(sig.sig_type)) {
        return false;
      }
      if (!sigSearchQuery) {
        return true;
      }
      return (
        sig.signature_id.toLowerCase().includes(sigSearchQuery) ||
        sig.sig_type.toLowerCase().includes(sigSearchQuery) ||
        Boolean(sig.wormhole_type?.code.toLowerCase().includes(sigSearchQuery))
      );
    })
    .sort((a, b) => a.signature_id.localeCompare(b.signature_id));

  const handleAddSignature = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newSigId.trim()) {
      return;
    }
    try {
      await addSignature(mapId, currentSystemId, {
        signature_id: newSigId.trim().toUpperCase(),
        sig_type: newSigType,
        wormhole_type_code: newWhCode.trim() || null,
      });
      setNewSigId("");
      setNewWhCode("");
    } catch (err) {
      setError(String(err));
    }
  };

  const handlePasteImport = async (event: React.FormEvent) => {
    event.preventDefault();
    const rows = parseProbeScanPaste(pasteText);
    if (rows.length === 0 && !lazyDelete) {
      return;
    }
    if (rows.length === 0 && lazyDelete) {
      const confirmed = window.confirm(
        `This will remove all ${signatures.length} signature${signatures.length === 1 ? "" : "s"} in this system. Continue?`,
      );
      if (!confirmed) {
        return;
      }
    }
    try {
      const result = await bulkUpsertSignatures(
        mapId,
        currentSystemId,
        rows.map((row) => ({
          signature_id: row.signatureId,
          sig_type: row.sigType,
        })),
        lazyDelete,
        removeDanglingSystems,
      );
      setPasteText("");
      const parts = [
        `Imported ${pluralize(result.signatures.length, "signature")}.`,
      ];
      const removedParts = (
        [
          [result.removed_signature_ids.length, "signature"],
          [result.removed_connection_ids.length, "connection"],
          [result.removed_system_ids.length, "system"],
        ] as const
      )
        .filter(([count]) => count > 0)
        .map(([count, noun]) => pluralize(count, noun));
      if (removedParts.length > 0) {
        parts.push(`Removed ${removedParts.join(", ")}.`);
      }
      setPasteMessage(parts.join(" "));
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <aside className="signature-panel">
      {finder}
      <div className="signature-panel-header">
        <h3>{system.label || system.solar_system.name}</h3>
        <div className="signature-panel-header-actions">
          <button
            type="button"
            className="link-button"
            onClick={() => centerOnSystem(currentSystemId)}
          >
            Center
          </button>
          <button type="button" className="link-button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <section>
        <h4>Signatures</h4>
        <div className="sig-filter-bar">
          <input
            type="text"
            className="sig-search-input"
            placeholder="Search signatures…"
            value={sigSearch}
            onChange={(event) => setSigSearch(event.target.value)}
          />
          <div className="sig-type-filter" ref={typeFilterRef}>
            <button
              type="button"
              className="icon-button"
              aria-label="Filter signature types"
              title={
                hiddenSigTypes.size > 0
                  ? `Filter signature types (${SIG_TYPES.length - hiddenSigTypes.size}/${SIG_TYPES.length} shown)`
                  : "Filter signature types"
              }
              onClick={() => setTypeFilterOpen((open) => !open)}
            >
              <i className="fas fa-filter" aria-hidden="true" />
              {hiddenSigTypes.size > 0 && (
                <span className="icon-button-badge">{hiddenSigTypes.size}</span>
              )}
            </button>
            {typeFilterOpen && (
              <div className="sig-type-filter-dropdown">
                {SIG_TYPES.map((t) => (
                  <label key={t}>
                    <input
                      type="checkbox"
                      checked={!hiddenSigTypes.has(t)}
                      onChange={() => toggleSigTypeVisible(t)}
                    />
                    {t}
                  </label>
                ))}
                <label>
                  <input
                    type="checkbox"
                    checked={showHidden}
                    onChange={() => setShowHidden((v) => !v)}
                  />
                  Show hidden
                </label>
              </div>
            )}
          </div>
        </div>
        <ul className="entry-list">
          {visibleSignatures.map((sig) => {
            const linkedConnection = connections.find(
              (c) =>
                c.top_signature_id === sig.id ||
                c.bottom_signature_id === sig.id,
            );
            const linkableConnections = connections.filter(
              (c) =>
                (c.top_system_id === currentSystemId &&
                  c.top_signature_id === null) ||
                (c.bottom_system_id === currentSystemId &&
                  c.bottom_signature_id === null),
            );
            // Prefer the linked connection's created_at (immutable) over the
            // signature's own updated_at (bumped by any edit) as the age
            // reference, once linked - see the matching backend logic in
            // wh_mapper.api.helpers.signature_reference_time. Otherwise a
            // signature edited recently could show as fresher than its own
            // connection, even though they're the same physical wormhole.
            const sigLifeStatus = effectiveLifeStatus(
              sig.life_status,
              sig.life_status_marked_at,
              sig.wormhole_type,
              linkedConnection?.created_at ?? sig.updated_at,
              now,
            );

            return (
              <li
                key={sig.id}
                className={
                  sig.is_hidden ? "entry-row entry-row-hidden" : "entry-row"
                }
              >
                <div className="entry-row-title">
                  <button
                    type="button"
                    className="link-button danger"
                    disabled={readOnly}
                    onClick={() =>
                      removeSignature(mapId, currentSystemId, sig.id).catch(
                        (err) => setError(String(err)),
                      )
                    }
                  >
                    ✕
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={readOnly}
                    aria-label={
                      sig.is_hidden ? "Unhide signature" : "Hide signature"
                    }
                    title={
                      sig.is_hidden ? "Unhide signature" : "Hide signature"
                    }
                    onClick={() =>
                      updateSignature(mapId, currentSystemId, sig.id, {
                        is_hidden: !sig.is_hidden,
                      }).catch((err) => setError(String(err)))
                    }
                  >
                    <i
                      className={
                        sig.is_hidden ? "fas fa-eye-slash" : "fas fa-eye"
                      }
                      aria-hidden="true"
                    />
                  </button>
                  <span className="mono">{sig.signature_id}</span>
                </div>
                <div className="entry-row-controls">
                  <select
                    value={sig.sig_type}
                    disabled={readOnly}
                    onChange={(event) =>
                      updateSignature(mapId, currentSystemId, sig.id, {
                        sig_type: event.target.value,
                      }).catch((err) => setError(String(err)))
                    }
                  >
                    {SIG_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  {sig.sig_type === "wormhole" &&
                    (sig.wormhole_type ? (
                      <span
                        className="dim mono"
                        title="Computed from the identified wormhole type's real lifetime"
                      >
                        {LIFE_STATUS_LABEL[sigLifeStatus] ?? sigLifeStatus}
                      </span>
                    ) : (
                      <select
                        value={sigLifeStatus}
                        disabled={readOnly}
                        onChange={(event) =>
                          updateSignature(mapId, currentSystemId, sig.id, {
                            life_status: event.target.value,
                          }).catch((err) => setError(String(err)))
                        }
                      >
                        {LIFE_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {LIFE_STATUS_LABEL[s] ?? s}
                          </option>
                        ))}
                      </select>
                    ))}
                  {sigLifeStatus === "lt_1h" && (
                    <span
                      className="eol-critical-badge"
                      title="Expected to collapse within the next hour"
                    >
                      ≤1h
                    </span>
                  )}
                  {sig.wormhole_type ? (
                    <span
                      className="mono dim"
                      title={wormholeTypeSummary(sig.wormhole_type)}
                    >
                      {sig.wormhole_type.code}
                    </span>
                  ) : (
                    sig.sig_type === "wormhole" && (
                      <input
                        type="text"
                        list={WORMHOLE_TYPE_DATALIST_ID}
                        placeholder="K162 (once identified)"
                        className="mono"
                        disabled={readOnly}
                        onBlur={(event) => {
                          const code = event.target.value.trim();
                          if (!code) {
                            return;
                          }
                          updateSignature(mapId, currentSystemId, sig.id, {
                            wormhole_type_code: code,
                          }).catch((err) => setError(String(err)));
                        }}
                      />
                    )
                  )}
                </div>
                {sig.wormhole_type && (
                  <div className="entry-row-controls dim">
                    {wormholeTypeSummary(sig.wormhole_type)}
                  </div>
                )}
                {sig.sig_type === "wormhole" && (
                  <div className="entry-row-controls">
                    {linkedConnection ? (
                      <span className="dim">
                        → {systemName(otherSystemId(linkedConnection))}
                      </span>
                    ) : readOnly ? null : (
                      <>
                        <button
                          type="button"
                          className="button-secondary"
                          title="Create a new connection to a system - including a second, separate wormhole to a system you're already linked to"
                          onClick={() => setConnectSignatureId(sig.id)}
                        >
                          Link to other system…
                        </button>
                        {linkableConnections.length > 0 && (
                          <select
                            value=""
                            title="Attach this signature to a connection that's already on the map but doesn't have a signature on this side yet"
                            onChange={(event) => {
                              const connectionId = Number(event.target.value);
                              if (connectionId) {
                                linkConnectionSignature(
                                  mapId,
                                  connectionId,
                                  sig.id,
                                ).catch((err) => setError(String(err)));
                              }
                            }}
                          >
                            <option value="">Attach to existing link…</option>
                            {linkableConnections.map((c) => (
                              <option key={c.id} value={c.id}>
                                → {systemName(otherSystemId(c))}
                              </option>
                            ))}
                          </select>
                        )}
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {!readOnly && (
          <form className="add-signature-form" onSubmit={handleAddSignature}>
            <input
              type="text"
              placeholder="ABC-123"
              className="mono"
              maxLength={7}
              value={newSigId}
              onChange={(event) => setNewSigId(event.target.value)}
            />
            <select
              value={newSigType}
              onChange={(event) => setNewSigType(event.target.value)}
            >
              {SIG_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            {newSigType === "wormhole" && (
              <>
                <input
                  type="text"
                  list={WORMHOLE_TYPE_DATALIST_ID}
                  placeholder="K162 (optional)"
                  className="mono"
                  value={newWhCode}
                  onChange={(event) => setNewWhCode(event.target.value)}
                />
                <datalist id={WORMHOLE_TYPE_DATALIST_ID}>
                  {wormholeTypeDatalistOptions(wormholeTypes).map((wt) => (
                    <option
                      key={wt.code}
                      value={wt.code}
                      label={wormholeTypeSummary(wt)}
                    />
                  ))}
                </datalist>
              </>
            )}
            <button type="submit">Add</button>
          </form>
        )}

        {!readOnly && (
          <form className="paste-signatures-form" onSubmit={handlePasteImport}>
            <textarea
              placeholder="Paste probe scan results here (Ctrl+A, Ctrl+C in the Scanner window)…"
              rows={3}
              value={pasteText}
              onChange={(event) => {
                setPasteText(event.target.value);
                setPasteMessage(null);
              }}
            />
            <label
              className="lazy-delete-toggle"
              title="After importing, remove any signature in this system that isn't in this paste (and any wormhole connection linked to it) — use after a full probe rescan."
            >
              <input
                type="checkbox"
                checked={lazyDelete}
                onChange={(event) => {
                  setLazyDelete(event.target.checked);
                  if (!event.target.checked) {
                    setRemoveDanglingSystems(false);
                  }
                }}
              />
              Lazy delete
            </label>
            {lazyDelete && (
              <label
                className="remove-dangling-systems-toggle"
                title="Also remove any system that ends up with zero connections after this import (unless it's locked as home base). Removes a whole dead-end chain in one go, not just the immediate neighbor."
              >
                <input
                  type="checkbox"
                  checked={removeDanglingSystems}
                  onChange={(event) =>
                    setRemoveDanglingSystems(event.target.checked)
                  }
                />
                Remove dangling systems
              </label>
            )}
            <button type="submit" disabled={!pasteText.trim() && !lazyDelete}>
              Import
            </button>
            {pasteMessage && <span className="dim">{pasteMessage}</span>}
          </form>
        )}
      </section>

      <section>
        <h4>Connections</h4>
        {connections.length === 0 ? (
          <p className="dim">No connections yet.</p>
        ) : (
          <ul className="entry-list">
            {connections.map((connection) => {
              const otherId =
                connection.top_system_id === systemId
                  ? connection.bottom_system_id
                  : connection.top_system_id;
              // Once either end's signature has an identified wormhole type,
              // its jump mass determines ship size outright - see the same
              // logic in MapCanvas's edge labels.
              const wormholeType = connectionWormholeType(
                connection,
                state.signatures,
              );
              const computedShipSize = wormholeType
                ? shipSizeForJumpMass(wormholeType.max_jump_mass)
                : null;
              const connectionLifeStatus = effectiveLifeStatus(
                connection.life_status,
                connection.life_status_marked_at,
                wormholeType,
                connection.created_at,
                now,
              );
              return (
                <li key={connection.id} className="entry-row">
                  <div className="entry-row-title">
                    <button
                      type="button"
                      className="link-button danger"
                      disabled={readOnly}
                      onClick={() =>
                        removeConnection(mapId, connection.id).catch((err) =>
                          setError(String(err)),
                        )
                      }
                    >
                      ✕
                    </button>
                    <span>→ {systemName(otherId)}</span>
                  </div>
                  <div className="entry-row-controls">
                    <select
                      value={connection.connection_type}
                      disabled={readOnly}
                      onChange={(event) =>
                        updateConnection(mapId, connection.id, {
                          connection_type: event.target.value as ConnectionType,
                        }).catch((err) => setError(String(err)))
                      }
                    >
                      {CONNECTION_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    {connection.connection_type === "wormhole" && (
                      <>
                        <select
                          value={connection.mass_status}
                          disabled={readOnly}
                          onChange={(event) =>
                            updateConnection(mapId, connection.id, {
                              mass_status: event.target.value,
                            }).catch((err) => setError(String(err)))
                          }
                        >
                          {MASS_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                        {wormholeType ? (
                          <span
                            className="dim mono"
                            title="Computed from the identified wormhole type's real lifetime"
                          >
                            {LIFE_STATUS_LABEL[connectionLifeStatus] ??
                              connectionLifeStatus}
                          </span>
                        ) : (
                          <select
                            value={connectionLifeStatus}
                            disabled={readOnly}
                            onChange={(event) =>
                              updateConnection(mapId, connection.id, {
                                life_status: event.target.value,
                              }).catch((err) => setError(String(err)))
                            }
                          >
                            {LIFE_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {LIFE_STATUS_LABEL[s] ?? s}
                              </option>
                            ))}
                          </select>
                        )}
                        {connectionLifeStatus === "lt_1h" && (
                          <span
                            className="eol-critical-badge"
                            title="Expected to collapse within the next hour"
                          >
                            ≤1h
                          </span>
                        )}
                        {computedShipSize ? (
                          <span
                            className="dim mono"
                            title={`Computed from wormhole type ${wormholeType?.code} (max jump mass ${wormholeType?.max_jump_mass?.toLocaleString()} kg)`}
                          >
                            {SHIP_SIZE_LABEL[computedShipSize] ??
                              computedShipSize}{" "}
                            ship size
                          </span>
                        ) : (
                          <select
                            value={connection.ship_size_limit}
                            disabled={readOnly}
                            onChange={(event) =>
                              updateConnection(mapId, connection.id, {
                                ship_size_limit: event.target.value,
                              }).catch((err) => setError(String(err)))
                            }
                          >
                            {SHIP_SIZE_LIMITS.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        )}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {!readOnly && (
        <div className="signature-panel-footer-actions">
          <button
            type="button"
            className="link-button"
            onClick={() =>
              updateSystem(mapId, currentSystemId, {
                pinned: !system.pinned,
              }).catch((err) => setError(String(err)))
            }
          >
            {system.pinned ? "Unlock system" : "Lock system (home base)"}
          </button>
          <button
            type="button"
            className="link-button danger"
            disabled={system.pinned}
            title={system.pinned ? "Locked - unlock it first" : undefined}
            onClick={() => {
              removeSystem(mapId, currentSystemId)
                .then(onClose)
                .catch((err) => setError(String(err)));
            }}
          >
            Remove system from map
          </button>
        </div>
      )}

      {connectSignatureId !== null && (
        <ConnectSignatureDialog
          mapId={mapId}
          sourceSystemId={currentSystemId}
          signatureId={connectSignatureId}
          existingSystems={state.systems}
          onSystemCreated={onSystemCreated}
          onClose={() => setConnectSignatureId(null)}
        />
      )}
    </aside>
  );
}
