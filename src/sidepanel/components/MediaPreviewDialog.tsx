import { useEffect, useState } from 'react';

interface MediaPreviewDialogProps {
  media: {
    id: string;
    kind: 'image' | 'video';
    label: string;
    remoteUrl?: string;
    blob?: Blob;
  } | null;
  onClose: () => void;
}

export function MediaPreviewDialog({ media, onClose }: MediaPreviewDialogProps) {
  useEffect(() => {
    if (media === null) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [media, onClose]);

  if (media === null) {
    return null;
  }

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
        className="media-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="媒体预览"
      >
        <div className="media-preview-dialog__heading">
          <h2>{media.label}</h2>
          <button type="button" className="button button--quiet" onClick={onClose}>
            关闭媒体预览
          </button>
        </div>
        <PreviewContent key={media.id} media={media} />
      </section>
    </div>
  );
}

function PreviewContent({ media }: { media: NonNullable<MediaPreviewDialogProps['media']> }) {
  if (media.remoteUrl !== undefined) {
    return <img src={media.remoteUrl} alt={media.label} />;
  }
  if (media.blob === undefined) {
    return <div className="media-preview-spinner" role="status" aria-label="正在加载媒体预览" />;
  }
  return <LocalPreviewContent media={{ ...media, blob: media.blob }} />;
}

function LocalPreviewContent({
  media
}: {
  media: NonNullable<MediaPreviewDialogProps['media']> & { blob: Blob };
}) {
  const [objectUrl] = useState(() => URL.createObjectURL(media.blob));

  useEffect(
    () => () => {
      URL.revokeObjectURL(objectUrl);
    },
    [objectUrl]
  );

  return media.kind === 'video' ? (
    <video controls src={objectUrl} aria-label={media.label} />
  ) : (
    <img src={objectUrl} alt={media.label} />
  );
}
