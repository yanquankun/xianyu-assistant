import { useRef, useState } from 'react';

import { getRemoteImageUrl, type ImageLoadStatus, type ProductImage, type ProductVideo } from '../../domain/product';
import { MAX_SELECTED_IMAGES } from '../../media/validation';
import type { StoredMediaAsset } from '../../storage/media-store';
import { MediaPreviewDialog } from './MediaPreviewDialog';

export interface MediaPickerProps {
  images: readonly ProductImage[];
  video?: ProductVideo | undefined;
  selectedCount: number;
  resolveLocalAsset: (assetId: string) => Promise<StoredMediaAsset | null>;
  onUploadImages: (files: readonly File[]) => void;
  onUploadVideo: (file: File) => void;
  onToggle: (id: string) => void;
  onRemoveImage: (id: string) => void;
  onRemoveVideo: () => void;
  onLoadStatus: (id: string, status: ImageLoadStatus) => void;
}

interface PreviewMedia {
  id: string;
  kind: 'image' | 'video';
  label: string;
  remoteUrl?: string;
  blob?: Blob;
}

export function MediaPicker({
  images,
  video,
  selectedCount,
  resolveLocalAsset,
  onUploadImages,
  onUploadVideo,
  onToggle,
  onRemoveImage,
  onRemoveVideo,
  onLoadStatus
}: MediaPickerProps) {
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PreviewMedia | null>(null);
  const [loadingPreview, setLoadingPreview] = useState<string | null>(null);

  const openLocalPreview = async (
    assetId: string,
    kind: 'image' | 'video',
    label: string,
    imageId?: string
  ) => {
    setLoadingPreview(assetId);
    try {
      const asset = await resolveLocalAsset(assetId);
      if (asset === null) {
        if (imageId !== undefined) {
          onLoadStatus(imageId, 'failed');
        }
        return;
      }
      setPreview({ id: assetId, kind, label, blob: asset.blob });
    } finally {
      setLoadingPreview((current) => (current === assetId ? null : current));
    }
  };

  const selectionLimitReached = selectedCount >= MAX_SELECTED_IMAGES;

  return (
    <>
      <div className="media-toolbar">
        <span>已选 {String(selectedCount)}/{String(MAX_SELECTED_IMAGES)}</span>
        <input
          ref={imageInput}
          className="media-file-input"
          aria-label="上传商品图片"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={selectionLimitReached}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            onUploadImages(files);
            event.currentTarget.value = '';
          }}
        />
        <button
          type="button"
          className="button button--quiet"
          disabled={selectionLimitReached}
          onClick={() => imageInput.current?.click()}
        >
          上传图片
        </button>
      </div>
      {selectionLimitReached ? <p className="empty-note">已达 9 张图片上限</p> : null}
      <div className="image-grid" aria-label="商品图片">
        {images.map((image, index) => {
          const imageNumber = index + 1;
          const remoteUrl = getRemoteImageUrl(image);
          const localLocation = image.location.kind === 'local' ? image.location : null;
          const label = `商品图片 ${String(imageNumber)}`;
          const previewLoading = localLocation !== null && loadingPreview === localLocation.assetId;
          return (
            <div
              className={`image-tile${image.selected ? ' image-tile--selected' : ''}`}
              key={image.id}
            >
              <button
                type="button"
                className="image-tile__preview"
                aria-label={`预览${label}`}
                disabled={previewLoading}
                onClick={() => {
                  if (remoteUrl !== null) {
                    setPreview({ id: image.id, kind: 'image', label, remoteUrl });
                    return;
                  }
                  if (localLocation !== null) {
                    void openLocalPreview(localLocation.assetId, 'image', label, image.id);
                  }
                }}
              >
                {remoteUrl === null ? (
                  <span className="image-tile__local-name">{localLocation?.fileName}</span>
                ) : (
                  <img
                    src={remoteUrl}
                    alt={label}
                    onLoad={() => onLoadStatus(image.id, 'loaded')}
                    onError={() => onLoadStatus(image.id, 'failed')}
                  />
                )}
              </button>
              <div className="media-tile-actions">
                <label>
                  <input
                    type="checkbox"
                    checked={image.selected}
                    disabled={
                      image.loadStatus === 'failed' || (!image.selected && selectionLimitReached)
                    }
                    onChange={() => onToggle(image.id)}
                    aria-label={`选择${label}`}
                  />
                  <span>
                    {image.loadStatus === 'failed' ? '加载失败' : image.selected ? '已选择' : '未选择'}
                  </span>
                </label>
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={() => {
                    setPreview(null);
                    onRemoveImage(image.id);
                  }}
                >
                  删除{label}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="video-card">
        <div>
          <strong>商品视频</strong>
          <p>{video === undefined ? '可选 MP4 或 MOV，最多 100 MB' : `${video.fileName}（${formatByteLength(video.byteLength)}）`}</p>
        </div>
        <div className="media-tile-actions">
          <input
            ref={videoInput}
            className="media-file-input"
            aria-label="上传商品视频"
            type="file"
            accept="video/mp4,video/quicktime,.mp4,.mov"
            onChange={(event) => {
              const file = event.currentTarget.files?.item(0);
              if (file !== null && file !== undefined) {
                onUploadVideo(file);
              }
              event.currentTarget.value = '';
            }}
          />
          <button type="button" className="button button--quiet" onClick={() => videoInput.current?.click()}>
            {video === undefined ? '上传视频' : '替换视频'}
          </button>
          {video === undefined ? null : (
            <>
              <button
                type="button"
                className="button button--quiet"
                onClick={() => void openLocalPreview(video.assetId, 'video', video.fileName)}
              >
                预览商品视频
              </button>
              <button
                type="button"
                className="button button--quiet"
                onClick={() => {
                  setPreview(null);
                  onRemoveVideo();
                }}
              >
                删除商品视频
              </button>
            </>
          )}
        </div>
      </div>
      <MediaPreviewDialog media={preview} onClose={() => setPreview(null)} />
    </>
  );
}

function formatByteLength(byteLength: number): string {
  return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`;
}
