import { type ReactNode, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { SocketStatus } from "../hooks/useMapSocket";
import { AppBrand } from "./AppBrand";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { SocketStatusBadge } from "./SocketStatusBadge";
import { TrackedCharactersPanel } from "./TrackedCharactersPanel";

interface Props {
  // The current page's title (e.g. a map's name) - shown right after the
  // brand, same "breadcrumb" spot the old per-page headers used.
  title?: string;
  // Primary, always-visible contextual actions for the current page (e.g.
  // MapView's "+ Add system") - rendered directly in the right zone.
  actions?: ReactNode;
  // Secondary contextual actions, tucked behind a "⋯" button instead of
  // competing for space in the bar itself - this is what actually fixes
  // the old MapView toolbar's overcrowding (Flags/Import region/Share/
  // Pending signatures all sat inline before).
  overflowItems?: ContextMenuItem[];
  // MapView's tracked-character count for *this* map - shown on the
  // button as "(N)"; omitted (no badge) on pages with no map open.
  trackedCharacterCount?: number;
  // The current page's own live socket status (MapView's useMapSocket) -
  // omitted (no badge) on pages with no live socket of their own. Shown
  // ahead of `actions` so it reads as ambient page state rather than one of
  // the page's own controls - see SocketStatusBadge.
  socketStatus?: SocketStatus;
}

// "Maps" also counts as active on /maps/:id (an open map is still "in" the
// maps section) - every other link just prefix-matches its own path
// (covers e.g. /route/shared/:id under "Navigate").
function isNavLinkActive(path: string, pathname: string): boolean {
  if (path === "/") {
    return pathname === "/" || pathname.startsWith("/maps/");
  }
  return pathname.startsWith(path);
}

function NavLink({ to, children }: { to: string; children: ReactNode }) {
  const { pathname } = useLocation();
  const active = isNavLinkActive(to, pathname);
  return (
    <Link
      to={to}
      className={`nav-link${active ? " nav-link-active" : ""}`}
      aria-current={active ? "page" : undefined}
    >
      {children}
    </Link>
  );
}

/** The one shared top nav, rendered by each page instead of each page (or
 * MapView specifically) building its own header. Two zones, left to right:
 * left is app-wide navigation (brand, current page's title, and the
 * Maps/Navigate/Status route links - the same on every page); right is
 * whatever the current page needs (Tracked characters is here rather than
 * the left zone since its badge count is page-contextual, plus each page's
 * own primary actions and overflow menu). See MapView for the fullest use
 * of `actions`/`overflowItems`; pages with nothing page-specific to show
 * just render `<AppHeader />` with no props.
 *
 * Flat navbar styling throughout (see .nav-link/.app-header button in
 * App.css) - text items with a hover/active color change, not bordered
 * button boxes, on either side of the bar.
 */
export function AppHeader({
  title,
  actions,
  overflowItems,
  trackedCharacterCount,
  socketStatus,
}: Props) {
  const [showTracking, setShowTracking] = useState(false);
  const [overflowAnchor, setOverflowAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);

  return (
    <>
      <header className="app-header">
        <div className="app-header-nav">
          <AppBrand />
          <NavLink to="/">Maps</NavLink>
          <NavLink to="/route">Navigate</NavLink>
          {/* Not permission-gated here - the page itself renders a plain
              "you don't have access" message for anyone without
              admin_access (see StatusPage), same as visiting a URL you
              can't use rather than the link not existing. */}
          <NavLink to="/status">Status</NavLink>
          {title && <h2 className="map-title">{title}</h2>}
        </div>

        <div className="app-header-context">
          {socketStatus && <SocketStatusBadge status={socketStatus} />}
          {actions}
          <button type="button" onClick={() => setShowTracking(true)}>
            Tracked characters
            {trackedCharacterCount !== undefined &&
              ` (${trackedCharacterCount})`}
          </button>
          {overflowItems && overflowItems.length > 0 && (
            <button
              type="button"
              className="app-header-overflow-button"
              title="More actions"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setOverflowAnchor({ x: rect.right, y: rect.bottom + 4 });
              }}
            >
              ⋯
            </button>
          )}
        </div>
      </header>

      {overflowAnchor && overflowItems && (
        <ContextMenu
          x={overflowAnchor.x}
          y={overflowAnchor.y}
          items={overflowItems}
          onClose={() => setOverflowAnchor(null)}
        />
      )}

      {showTracking && (
        <TrackedCharactersPanel onClose={() => setShowTracking(false)} />
      )}
    </>
  );
}
