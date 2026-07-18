import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Props {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

/** Shared modal shell for every dialog/panel in the app - backdrop click and
 * Escape both close it, Tab is trapped inside it, and focus returns to
 * whatever opened it on close. Previously each dialog (AddSystemDialog,
 * ConnectSignatureDialog, IdentifyJumpSignatureDialog, ImportRegionDialog,
 * ShareDialog, TrackedCharactersPanel) reimplemented the backdrop/stop-
 * propagation shell by hand with none of this - ContextMenu already got
 * Escape/outside-click right for the canvas's right-click menu; this is the
 * equivalent for full dialogs. */
export function Dialog({ title, onClose, children }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();

    return () => {
      previouslyFocused?.focus();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleTabTrap = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") {
      return;
    }
    const focusable =
      dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (!focusable || focusable.length === 0) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleTabTrap}
      >
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}
