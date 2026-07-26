import type { RouteContributorOut } from "../api/types";

interface Props {
  contributors: RouteContributorOut[];
}

/** Who to credit (and pay a bounty) for the wormhole connections making up
 * a computed route - see wh_mapper.models.MapContribution. Renders nothing
 * for a route with no wormhole-connection legs to credit (e.g. pure
 * stargate hops), same "just omit the section" convention as
 * RouteAlternateBanner not rendering when there's no alternate. */
export function RouteContributors({ contributors }: Props) {
  if (contributors.length === 0) {
    return null;
  }

  return (
    <div className="route-contributors">
      <h3 className="route-contributors-title">Contributors</h3>
      <ul className="route-contributors-list">
        {contributors.map((contributor) => (
          <li
            key={contributor.character_id ?? contributor.name}
            className="route-contributors-item"
          >
            <span className="route-contributors-name">{contributor.name}</span>
            <span className="route-contributors-count">
              ×{contributor.contribution_count}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
