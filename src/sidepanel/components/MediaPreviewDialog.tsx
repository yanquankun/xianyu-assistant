import { useEffect, useRef } from 'react';

interface MediaPreviewDialogProps {
  media: {
    id: string;
    kind: 'image' | 'video';
    label: string;
    remoteUrl?: string;
    objectUrl?: string;
    trigger: HTMLElement;
  } | null;
  onClose: () => void;
}

export function MediaPreviewDialog({ media, onClose }: MediaPreviewDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (media === null) {
      return;
    }
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      media.trigger.focus();
    };
  }, [media, onClose]);

  if (media === null) {
    return null;
  }

  const source = media.remoteUrl ?? media.objectUrl;
  return (
    <div
      className="media-preview-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.currentTarget === event.target) {
          onClose();
        }
      }}
    >
      <section
        ref={dialogRef}
        className="media-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="媒体预览"
        onKeyDown={(event) => trapTabFocus(event, dialogRef.current)}
      >
        <div className="media-preview-dialog__heading">
          <h2>{media.label}</h2>
          <button ref={closeButtonRef} type="button" className="button button--quiet" onClick={onClose}>
            关闭媒体预览
          </button>
        </div>
        {source === undefined ? (
          <div className="media-preview-spinner" role="status" aria-label="正在加载媒体预览" />
        ) : media.kind === 'video' ? (
          <video controls src={source} aria-label={media.label} />
        ) : (
          <img src={source} alt={media.label} />
        )}
      </section>
    </div>
  );
}

function trapTabFocus(event: React.KeyboardEvent<HTMLElement>, dialog: HTMLElement | null): void {
  if (event.key !== 'Tab' || dialog === null) {
    return;
  }
  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
    )
  );
  const first = focusable[0];
  const last = focusable.at(-1);
  if (first === undefined || last === undefined) {
    event.preventDefault();
    return;
  }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
