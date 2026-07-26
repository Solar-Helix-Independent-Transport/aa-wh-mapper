/** "3h ago" / "2d ago" style label for a timestamp - a superset of
 * TrackedCharactersPanel's inline hours-only version (which never needs to
 * express anything longer than "a few hours", since it's about whether a
 * character is currently online), extended with days/months/years for
 * things like a Map's last_updated, which can realistically be weeks old. */
export function relativeTimeLabel(isoTimestamp: string): string {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(isoTimestamp).getTime()) / 1000),
  );

  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    return `${months}mo ago`;
  }
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}
