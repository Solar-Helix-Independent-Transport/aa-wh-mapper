interface Props {
  showingAlternate: boolean;
  onToggle: () => void;
}

/** Shown whenever a route has a strictly-shorter, risk-ignoring alternative
 * (see wh_mapper.pathfinding.RouteComputation.alternate) - the risk-weighted
 * route stays the default view, but this lets the user switch to see the
 * faster option and judge the tradeoff themselves rather than the tool
 * silently picking for them. Shared between RouteFinder and SharedRoute. */
export function RouteAlternateBanner({ showingAlternate, onToggle }: Props) {
  return (
    <div
      className={`route-alternate-banner${showingAlternate ? " route-alternate-banner-risky" : ""}`}
    >
      <span>
        {showingAlternate
          ? "Viewing a shorter route through a connection that's about to collapse."
          : "A shorter route exists through a connection that's about to collapse."}
      </span>
      <button type="button" onClick={onToggle}>
        {showingAlternate ? "View safe route" : "View risky route"}
      </button>
    </div>
  );
}
