import { FocusTrap } from "focus-trap-react";
import { ModalBackdrop } from "./ModalBackdrop.js";
import { buttonPrimary, buttonSecondary, typeScale } from "../../styles/shared.js";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for a destructive/hiding action (e.g. archive). */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const dangerButtonStyle = {
  ...buttonPrimary,
  // --danger-button-bg, not --status-danger: --status-danger (--accent-red)
  // is tuned for small text/icons on the page background, and white button
  // text on it is only ~3.35:1 in dark mode. --danger-button-bg is a fill
  // colour chosen to clear WCAG AA's 4.5:1 in both themes — see src/App.css.
  background: "var(--danger-button-bg)",
};

/**
 * Small centered confirmation modal. Keyboard-accessible: focus is trapped
 * inside, Escape and a backdrop click both cancel, and the first tabbable
 * element (Cancel) gets initial focus rather than the destructive action.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: Readonly<ConfirmDialogProps>) {
  return (
    <FocusTrap
      focusTrapOptions={{
        escapeDeactivates: true,
        clickOutsideDeactivates: true,
        onDeactivate: onCancel,
        // Same as HelpOverlay/OnboardingWizard/TaskEditDrawer: jsdom reports
        // zero-size layout for everything, so focus-trap's default visibility
        // check (getClientRects/checkVisibility) sees no tabbable node and
        // throws "must have at least one container with at least one tabbable
        // node" in tests, even though real buttons are present. Skipping the
        // display check is safe here since the dialog is never rendered
        // hidden-but-mounted.
        tabbableOptions: { displayCheck: "none" },
      }}
    >
      <div>
        <ModalBackdrop onClick={onCancel} zIndex={200} />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          aria-describedby="confirm-dialog-message"
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 201,
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            borderRadius: "12px",
            padding: "24px",
            maxWidth: "420px",
            width: "90%",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          }}
        >
          <h2
            id="confirm-dialog-title"
            style={{ ...typeScale.h2, color: "var(--text-primary)", margin: "0 0 8px" }}
          >
            {title}
          </h2>
          <p
            id="confirm-dialog-message"
            style={{ color: "var(--text-secondary)", fontSize: "13px", margin: "0 0 20px" }}
          >
            {message}
          </p>
          <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
            <button type="button" onClick={onCancel} style={buttonSecondary}>
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              style={destructive ? dangerButtonStyle : buttonPrimary}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </FocusTrap>
  );
}
