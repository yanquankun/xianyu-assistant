import { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  title: string;
  description: string;
  cancelLabel: string;
  confirmLabel: string;
  isConfirming: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  title,
  description,
  cancelLabel,
  confirmLabel,
  isConfirming,
  onCancel,
  onConfirm
}: ConfirmDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isConfirming) {
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isConfirming, onCancel]);

  return (
    <div className="confirm-dialog-backdrop">
      <section
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
      >
        <h2 id="confirm-dialog-title">{title}</h2>
        <p id="confirm-dialog-description">{description}</p>
        <div className="confirm-dialog__actions">
          <button
            ref={cancelButtonRef}
            className="button button--quiet"
            type="button"
            disabled={isConfirming}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            className="button button--primary"
            type="button"
            disabled={isConfirming}
            onClick={onConfirm}
          >
            {isConfirming ? '正在清除' : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
