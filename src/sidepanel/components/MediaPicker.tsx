import { useEffect, useRef, useState } from 'react';

import {
  getRemoteImageUrl,
  type ImageLoadStatus,
  type ProductImage,
  type ProductVideo
} from '../../domain/product';
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
  objectUrl?: string;
  trigger: HTMLElement;
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
  const previewRef = useRef<PreviewMedia | null>(null);
  const previewRequestRef = useRef(0);
  const mountedRef = useRef(true);
  const mediaRef = useRef({ images, video });
  const [preview, setPreview] = useState<PreviewMedia | null>(null);
  const [loadingPreview, setLoadingPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    mediaRef.current = { images, video };
  }, [images, video]);

  const disposePreview = () => {
    const current = previewRef.current;
    if (current?.objectUrl !== undefined) {
      URL.revokeObjectURL(current.objectUrl);
    }
    previewRef.current = null;
  };

  const invalidatePreview = () => {
    previewRequestRef.current += 1;
    disposePreview();
    setPreview(null);
    setLoadingPreview(null);
  };

  const replacePreview = (next: PreviewMedia) => {
    disposePreview();
    previewRef.current = next;
    setPreview(next);
  };

  useEffect(
    () => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        previewRequestRef.current += 1;
        disposePreview();
      };
    },
    []
  );

  const openLocalPreview = async (
    assetId: string,
    kind: 'image' | 'video',
    label: string,
    trigger: HTMLElement,
    imageId?: string
  ) => {
    const requestToken = previewRequestRef.current + 1;
    previewRequestRef.current = requestToken;
    disposePreview();
    setPreview(null);
    setPreviewError(null);
    setLoadingPreview(assetId);
    try {
      const asset = await resolveLocalAsset(assetId);
      if (!isPreviewRequestCurrent(requestToken, assetId, kind, mountedRef, previewRequestRef, mediaRef)) {
        return;
      }
      if (asset === null) {
        showPreviewReadFailure(kind, imageId, onLoadStatus, setPreviewError);
        return;
      }
      const objectUrl = URL.createObjectURL(asset.blob);
      if (!isPreviewRequestCurrent(requestToken, assetId, kind, mountedRef, previewRequestRef, mediaRef)) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      replacePreview({ id: assetId, kind, label, objectUrl, trigger });
    } catch {
      if (isPreviewRequestCurrent(requestToken, assetId, kind, mountedRef, previewRequestRef, mediaRef)) {
        showPreviewReadFailure(kind, imageId, onLoadStatus, setPreviewError);
      }
    } finally {
      if (mountedRef.current && previewRequestRef.current === requestToken) {
        setLoadingPreview(null);
      }
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
      {previewError === null ? null : <p className="error-message">{previewError}</p>}
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
                onClick={(event) => {
                  if (remoteUrl !== null) {
                    previewRequestRef.current += 1;
                    setPreviewError(null);
                    replacePreview({
                      id: image.id,
                      kind: 'image',
                      label,
                      remoteUrl,
                      trigger: event.currentTarget
                    });
                    return;
                  }
                  if (localLocation !== null) {
                    void openLocalPreview(
                      localLocation.assetId,
                      'image',
                      label,
                      event.currentTarget,
                      image.id
                    );
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
                    invalidatePreview();
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
          <p>
            {video === undefined
              ? '可选 MP4 或 MOV，最多 100 MB'
              : `${video.fileName}（${formatByteLength(video.byteLength)}）`}
          </p>
        </div>
        <div className="media-tile-actions">
          <input
            ref={videoInput}
            className="media-file-input"
            aria-label="上传商品视频"
            type="file"
            accept="video/mp4,video/quicktime,.mp4,.mov"
            onChange={(event) => {
              const file = Array.from(event.currentTarget.files ?? [])[0];
              if (file !== undefined) {
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
                onClick={(event) =>
                  void openLocalPreview(video.assetId, 'video', video.fileName, event.currentTarget)
                }
              >
                预览商品视频
              </button>
              <button
                type="button"
                className="button button--quiet"
                onClick={() => {
                  invalidatePreview();
                  onRemoveVideo();
                }}
              >
                删除商品视频
              </button>
            </>
          )}
        </div>
      </div>
      <MediaPreviewDialog media={preview} onClose={invalidatePreview} />
    </>
  );
}

function isPreviewRequestCurrent(
  requestToken: number,
  assetId: string,
  kind: 'image' | 'video',
  mountedRef: { current: boolean },
  requestRef: { current: number },
  mediaRef: { current: { images: readonly ProductImage[]; video: ProductVideo | undefined } }
): boolean {
  if (!mountedRef.current || requestRef.current !== requestToken) {
    return false;
  }
  return kind === 'video'
    ? mediaRef.current.video?.assetId === assetId
    : mediaRef.current.images.some(
        (image) => image.location.kind === 'local' && image.location.assetId === assetId
      );
}

function showPreviewReadFailure(
  kind: 'image' | 'video',
  imageId: string | undefined,
  onLoadStatus: (id: string, status: ImageLoadStatus) => void,
  setPreviewError: (message: string) => void
): void {
  if (kind === 'image' && imageId !== undefined) {
    onLoadStatus(imageId, 'failed');
    setPreviewError('无法读取本地图片，请重试');
    return;
  }
  setPreviewError('无法读取本地视频，请重试');
}

function formatByteLength(byteLength: number): string {
  return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`;
}
