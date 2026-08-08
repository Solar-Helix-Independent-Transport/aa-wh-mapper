import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { getAppStatus } from "../api/status";
import type {
  AppStatusOut,
  MapSummaryOut,
  RouteSummaryOut,
} from "../api/types";
import { relativeTimeLabel } from "../lib/relativeTime";
import { AppHeader } from "./AppHeader";
import { DataTable } from "./DataTable";
import { dataTableColumnHelper } from "./dataTableFeatures";
import { LoadingState } from "./LoadingState";

const mapColumnHelper = dataTableColumnHelper<MapSummaryOut>();
const mapColumns = mapColumnHelper.columns([
  mapColumnHelper.accessor("name", { header: "Name" }),
  mapColumnHelper.accessor("owner_name", { header: "Owner" }),
  mapColumnHelper.accessor("visibility", { header: "Visibility" }),
  mapColumnHelper.accessor("system_count", { header: "Systems" }),
  mapColumnHelper.accessor("active_users", { header: "Viewers now" }),
  mapColumnHelper.accessor("last_updated", {
    header: "Last updated",
    cell: (info) => relativeTimeLabel(info.getValue()),
  }),
]);

const routeColumnHelper = dataTableColumnHelper<RouteSummaryOut>();
const routeColumns = routeColumnHelper.columns([
  routeColumnHelper.accessor(
    (route) => `${route.start_system_name} → ${route.end_system_name}`,
    { id: "route", header: "Route" },
  ),
  routeColumnHelper.accessor("owner_name", { header: "Owner" }),
  routeColumnHelper.accessor("visibility", { header: "Visibility" }),
  routeColumnHelper.accessor("found", {
    header: "Found",
    cell: (info) => (info.getValue() ? "yes" : "no"),
  }),
  routeColumnHelper.accessor("last_viewed_at", {
    header: "Last viewed",
    cell: (info) => relativeTimeLabel(info.getValue()),
  }),
]);

function StatDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`status-dot ${ok ? "status-dot-ok" : "status-dot-bad"}`}
      aria-hidden="true"
    />
  );
}

/** App-wide health/status for map admins - see wh_mapper.api.helpers.
 * app_status_to_schema for what's gathered and why. Reachable by anyone
 * with basic_access (the nav link isn't hidden), but the API itself is
 * admin_access-gated - a non-admin just sees a plain "you don't have
 * access" message here rather than the page not existing at all. */
export function StatusPage() {
  const [status, setStatus] = useState<AppStatusOut | null>(null);
  const [error, setError] = useState<ApiError | string | null>(null);

  useEffect(() => {
    getAppStatus()
      .then(setStatus)
      .catch((err) => setError(err instanceof ApiError ? err : String(err)));
  }, []);

  if (error) {
    if (error instanceof ApiError && error.status === 403) {
      return (
        <>
          <AppHeader />
          <div className="status-page">
            <p className="error">
              You don't have permission to view this page.
            </p>
          </div>
        </>
      );
    }
    return (
      <>
        <AppHeader />
        <div className="status-page">
          <p className="error">{String(error)}</p>
        </div>
      </>
    );
  }

  if (!status) {
    return (
      <>
        <AppHeader />
        <LoadingState label="Loading status…" />
      </>
    );
  }

  const {
    sde,
    tasks,
    usage,
    wormhole_types: wormholeTypes,
    maps,
    routes,
  } = status;
  const jspaceClassPercent =
    sde.total_jspace_systems > 0
      ? Math.round(
          (sde.jspace_with_raw_wormhole_class / sde.total_jspace_systems) * 100,
        )
      : 0;

  return (
    <>
      <AppHeader />
      <div className="status-page">
        <h1>App Status</h1>

        <section className="status-card">
          <h2>SDE import</h2>
          <div className="status-stat-row">
            <div className="status-stat">
              <span className="status-stat-label">Build</span>
              <span className="status-stat-value">
                {sde.build_number ?? "never imported"}
              </span>
            </div>
            <div className="status-stat">
              <span className="status-stat-label">Release</span>
              <span className="status-stat-value">
                {sde.release_date ? relativeTimeLabel(sde.release_date) : "—"}
              </span>
            </div>
            <div className="status-stat">
              <span className="status-stat-label">Last checked</span>
              <span className="status-stat-value">
                {sde.last_check_date
                  ? relativeTimeLabel(sde.last_check_date)
                  : "—"}
              </span>
            </div>
            <div className="status-stat">
              <span className="status-stat-label">Solar systems</span>
              <span className="status-stat-value">
                {sde.total_solar_systems.toLocaleString()}
              </span>
            </div>
          </div>

          {/* CCP's own static-data export barely covers wormholeClassID for
            ordinary J-space systems - a low percentage here is normal, not
            a sign the import is broken. wh_mapper derives the class from
            the region-name letter convention instead (see
            wh_mapper.api.helpers.wormhole_class_id) - this row is here so
            that derivation's actual coverage floor is visible, not implied
            to be a bug. */}
          <p className="dim status-note">
            {sde.jspace_with_raw_wormhole_class.toLocaleString()} of{" "}
            {sde.total_jspace_systems.toLocaleString()} J-space systems (
            {jspaceClassPercent}%) have CCP's own wormhole-class field set -
            expect this to stay low even on a fresh import; the rest is derived
            from the region-name convention instead, not missing data.
          </p>
        </section>

        <section className="status-card">
          <h2>Background tasks</h2>
          <table className="status-table">
            <thead>
              <tr>
                <th></th>
                <th>Task</th>
                <th>Last run</th>
                <th>Expected every</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.task_name}>
                  <td>
                    <StatDot ok={!task.stale && task.last_success !== false} />
                  </td>
                  <td>{task.task_name}</td>
                  <td title={task.last_error || undefined}>
                    {task.last_run_at
                      ? relativeTimeLabel(task.last_run_at)
                      : "never run"}
                    {task.last_success === false && " (failed)"}
                  </td>
                  <td>{task.expected_interval_seconds}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="status-card">
          <h2>Usage</h2>
          <div className="status-stat-row">
            <div className="status-stat">
              <span className="status-stat-label">Maps</span>
              <span className="status-stat-value">
                {usage.total_maps.toLocaleString()}
              </span>
            </div>
            <div className="status-stat">
              <span className="status-stat-label">Private</span>
              <span className="status-stat-value">
                {usage.private_maps.toLocaleString()}
              </span>
            </div>
            <div className="status-stat">
              <span className="status-stat-label">Shared</span>
              <span className="status-stat-value">
                {usage.shared_maps.toLocaleString()}
              </span>
            </div>
            <div className="status-stat">
              <span className="status-stat-label">Tracked characters</span>
              <span className="status-stat-value">
                {usage.active_tracked_characters.toLocaleString()}
              </span>
            </div>
            <div className="status-stat">
              <span className="status-stat-label">Live viewers</span>
              <span className="status-stat-value">
                {usage.live_map_presences.toLocaleString()}
              </span>
            </div>
          </div>
        </section>

        <section className="status-card">
          <h2>Wormhole type coverage</h2>
          <p className="dim status-note">
            Low numbers here mean <code>wh_mapper_derive_wormhole_types</code>{" "}
            needs a rerun (e.g. after a fresh SDE import).
          </p>
          <div className="status-stat-row">
            <div className="status-stat">
              <span className="status-stat-label">Total</span>
              <span className="status-stat-value">
                {wormholeTypes.total.toLocaleString()}
              </span>
            </div>
            <div className="status-stat">
              <span className="status-stat-label">Leads-to class</span>
              <span className="status-stat-value">
                {wormholeTypes.with_leads_to_class.toLocaleString()}
              </span>
            </div>
            <div className="status-stat">
              <span className="status-stat-label">Max mass</span>
              <span className="status-stat-value">
                {wormholeTypes.with_max_mass.toLocaleString()}
              </span>
            </div>
            <div className="status-stat">
              <span className="status-stat-label">Max jump mass</span>
              <span className="status-stat-value">
                {wormholeTypes.with_max_jump_mass.toLocaleString()}
              </span>
            </div>
            <div className="status-stat">
              <span className="status-stat-label">Max stable time</span>
              <span className="status-stat-value">
                {wormholeTypes.with_max_stable_time.toLocaleString()}
              </span>
            </div>
          </div>
        </section>

        <section className="status-card">
          <DataTable
            title={`Maps (${maps.length})`}
            data={maps}
            columns={mapColumns}
            getRowId={(map) => String(map.id)}
            searchPlaceholder="Search maps…"
            emptyMessage="No maps exist yet."
          />
        </section>

        <section className="status-card">
          <DataTable
            title={`Routes (${routes.length})`}
            data={routes}
            columns={routeColumns}
            getRowId={(route) => String(route.id)}
            searchPlaceholder="Search routes…"
            emptyMessage="No shared routes exist yet."
          />
        </section>
      </div>
    </>
  );
}
