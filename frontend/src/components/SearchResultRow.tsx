import type { KeyboardEvent, ReactNode } from "react";

interface Props {
  onSelect: () => void;
  children: ReactNode;
}

/** A single row in a `.search-results` list (AddSystemDialog,
 * ConnectSignatureDialog, ShareDialog, IdentifyJumpSignatureDialog's
 * existing-signature picker) - reachable and activatable via keyboard
 * (Tab/Enter/Space), not just a mouse click. */
export function SearchResultRow({ onSelect, children }: Props) {
  const handleKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect();
    }
  };

  return (
    <li role="button" tabIndex={0} onClick={onSelect} onKeyDown={handleKeyDown}>
      {children}
    </li>
  );
}
