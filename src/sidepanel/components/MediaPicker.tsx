import { useEffect, useRef, useState } from 'react';

import {
  getRemoteImageUrl,
  type ImageLoadStatus,
  type ProductImage,
  type ProductVideo
} from '../../domain/product';
import { MAX_MEDIA_COUNT } from '../../media/validation';
import type { StoredMediaAsset } from '../../storage/media-store';
import { MediaPreviewDialog } from './MediaPreviewDialog';

export interface MediaPickerProps {
  images: readonly ProductImage[];
  videos?: readonly ProductVideo[];
  isUploadingImages?: boolean;
  isUploadingVideos?: boolean;
  resolveLocalAsset: (assetId: string) => Promise<StoredMediaAsset | null>;
  onUploadImages: (files: readonly File[]) => void;
  onUploadVideos: (files: readonly File[]) => void;
  onRemoveImage: (id: string) => void;
  onRemoveVideo: (id: string) => void;
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

interface LocalImageThumbnailProps {
  assetId: string;
  imageId: string;
  label: string;
  loadStatus: ImageLoadStatus;
  resolveLocalAsset: (assetId: string) => Promise<StoredMediaAsset | null>;
  onLoadStatus: (id: string, status: ImageLoadStatus) => void;
}

interface LocalVideoThumbnailProps {
  assetId: string;
  label: string;
  resolveLocalAsset: (assetId: string) => Promise<StoredMediaAsset | null>;
}

function LocalImageThumbnail({
  assetId,
  imageId,
  label,
  loadStatus,
  resolveLocalAsset,
  onLoadStatus
}: LocalImageThumbnailProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const resolveLocalAssetRef = useRef(resolveLocalAsset);
  const onLoadStatusRef = useRef(onLoadStatus);

  useEffect(() => {
    resolveLocalAssetRef.current = resolveLocalAsset;
    onLoadStatusRef.current = onLoadStatus;
  }, [onLoadStatus, resolveLocalAsset]);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    void resolveLocalAssetRef
      .current(assetId)
      .then((asset) => {
        if (asset === null) {
          if (active) {
            setThumbnailFailed(true);
            onLoadStatusRef.current(imageId, 'failed');
          }
          return;
        }

        if (!active) {
          return;
        }
        objectUrl = URL.createObjectURL(asset.blob);
        setThumbnailUrl(objectUrl);
      })
      .catch(() => {
        if (active) {
          setThumbnailFailed(true);
          onLoadStatusRef.current(imageId, 'failed');
        }
      });

    return () => {
      active = false;
      if (objectUrl !== null) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [assetId, imageId]);

  if (thumbnailUrl === null) {
    return (
      <span className="image-tile__placeholder">
        {thumbnailFailed || loadStatus === 'failed' ? '加载失败' : '加载中'}
      </span>
    );
  }

  return (
    <img
      src={thumbnailUrl}
      alt={label}
      onLoad={() => onLoadStatusRef.current(imageId, 'loaded')}
      onError={() => onLoadStatusRef.current(imageId, 'failed')}
    />
  );
}

function LocalVideoThumbnail({
  assetId,
  label,
  resolveLocalAsset
}: LocalVideoThumbnailProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const resolveLocalAssetRef = useRef(resolveLocalAsset);

  useEffect(() => {
    resolveLocalAssetRef.current = resolveLocalAsset;
  }, [resolveLocalAsset]);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    void resolveLocalAssetRef
      .current(assetId)
      .then((asset) => {
        if (!active) {
          return;
        }
        if (asset?.kind !== 'video') {
          setThumbnailFailed(true);
          return;
        }
        objectUrl = URL.createObjectURL(asset.blob);
        setThumbnailUrl(objectUrl);
      })
      .catch(() => {
        if (active) {
          setThumbnailFailed(true);
        }
      });

    return () => {
      active = false;
      if (objectUrl !== null) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [assetId]);

  if (thumbnailUrl === null) {
    return (
      <span className="video-tile__placeholder">
        {thumbnailFailed ? '封面不可用' : '加载中'}
      </span>
    );
  }

  return (
    <video
      className="video-tile__media"
      src={thumbnailUrl}
      aria-label={`${label} 封面`}
      muted
      playsInline
      preload="metadata"
    />
  );
}

export function MediaPicker({
  images,
  videos = [],
  isUploadingImages = false,
  isUploadingVideos = false,
  resolveLocalAsset,
  onUploadImages,
  onUploadVideos,
  onRemoveImage,
  onRemoveVideo,
  onLoadStatus
}: MediaPickerProps) {
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const previewRef = useRef<PreviewMedia | null>(null);
  const previewRequestRef = useRef(0);
  const mountedRef = useRef(true);
  const mediaRef = useRef({ images, videos });
  const [preview, setPreview] = useState<PreviewMedia | null>(null);
  const [loadingPreview, setLoadingPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    mediaRef.current = { images, videos };
  }, [images, videos]);

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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      previewRequestRef.current += 1;
      disposePreview();
    };
  }, []);

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
      if (
        !isPreviewRequestCurrent(
          requestToken,
          assetId,
          kind,
          mountedRef,
          previewRequestRef,
          mediaRef
        )
      ) {
        return;
      }
      if (asset === null) {
        showPreviewReadFailure(kind, imageId, onLoadStatus, setPreviewError);
        return;
      }
      const objectUrl = URL.createObjectURL(asset.blob);
      if (
        !isPreviewRequestCurrent(
          requestToken,
          assetId,
          kind,
          mountedRef,
          previewRequestRef,
          mediaRef
        )
      ) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      replacePreview({ id: assetId, kind, label, objectUrl, trigger });
    } catch {
      if (
        isPreviewRequestCurrent(
          requestToken,
          assetId,
          kind,
          mountedRef,
          previewRequestRef,
          mediaRef
        )
      ) {
        showPreviewReadFailure(kind, imageId, onLoadStatus, setPreviewError);
      }
    } finally {
      if (mountedRef.current && previewRequestRef.current === requestToken) {
        setLoadingPreview(null);
      }
    }
  };

  const mediaCount = images.length + videos.length;
  const mediaLimitReached = mediaCount >= MAX_MEDIA_COUNT;

  return (
    <>
      <div className="media-toolbar">
        <span>
          媒体 {String(mediaCount)}/{String(MAX_MEDIA_COUNT)}
        </span>
        <input
          ref={imageInput}
          className="media-file-input"
          aria-label="上传商品图片"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={mediaLimitReached || isUploadingImages}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            onUploadImages(files);
            event.currentTarget.value = '';
          }}
        />
        <button
          type="button"
          className="button button--quiet"
          aria-busy={isUploadingImages}
          disabled={mediaLimitReached || isUploadingImages}
          onClick={() => imageInput.current?.click()}
        >
          {isUploadingImages ? '上传中…' : '上传图片'}
        </button>
      </div>
      {mediaLimitReached ? <p className="empty-note">已达 9 个媒体上限</p> : null}
      {previewError === null ? null : <p className="error-message">{previewError}</p>}
      <div className="image-grid" aria-label="商品图片">
        {images.map((image, index) => {
          const imageNumber = index + 1;
          const remoteUrl = getRemoteImageUrl(image);
          const localLocation = image.location.kind === 'local' ? image.location : null;
          const label = `商品图片 ${String(imageNumber)}`;
          const previewLoading = localLocation !== null && loadingPreview === localLocation.assetId;
          return (
            <div className="image-tile" key={image.id}>
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
                {localLocation !== null ? (
                  <LocalImageThumbnail
                    assetId={localLocation.assetId}
                    imageId={image.id}
                    label={label}
                    loadStatus={image.loadStatus}
                    resolveLocalAsset={resolveLocalAsset}
                    onLoadStatus={onLoadStatus}
                  />
                ) : (
                  <img
                    src={remoteUrl ?? undefined}
                    alt={label}
                    onLoad={() => onLoadStatus(image.id, 'loaded')}
                    onError={() => onLoadStatus(image.id, 'failed')}
                  />
                )}
              </button>
              <button
                type="button"
                className="image-tile__remove"
                aria-label={`删除${label}`}
                title={`删除${label}`}
                onClick={() => {
                  invalidatePreview();
                  onRemoveImage(image.id);
                }}
              >
                删除
              </button>
            </div>
          );
        })}
      </div>
      <div className="video-card video-card--upload">
        <div>
          <strong>商品视频</strong>
          <p>可选 MP4 或 MOV，单个最多 100 MB</p>
        </div>
        <div className="media-tile-actions">
          <input
            ref={videoInput}
            className="media-file-input"
            aria-label="上传商品视频"
            type="file"
            accept="video/mp4,video/quicktime,.mp4,.mov"
            multiple
            disabled={mediaLimitReached || isUploadingVideos}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              onUploadVideos(files);
              event.currentTarget.value = '';
            }}
          />
          <button
            type="button"
            className="button button--quiet"
            aria-busy={isUploadingVideos}
            disabled={mediaLimitReached || isUploadingVideos}
            onClick={() => videoInput.current?.click()}
          >
            {isUploadingVideos ? '上传中…' : '上传视频'}
          </button>
        </div>
      </div>
      <div className="video-grid" aria-label="商品视频">
        {videos.map((video, index) => {
          const videoNumber = index + 1;
          const label = `商品视频 ${String(videoNumber)}`;
          const previewLoading = loadingPreview === video.assetId;
          return (
            <div className="video-tile" key={video.id}>
              <button
                type="button"
                className="video-tile__preview"
                aria-label={`播放${label}`}
                disabled={previewLoading}
                onClick={(event) =>
                  void openLocalPreview(video.assetId, 'video', label, event.currentTarget)
                }
              >
                <LocalVideoThumbnail
                  assetId={video.assetId}
                  label={label}
                  resolveLocalAsset={resolveLocalAsset}
                />
                <span className="video-tile__play" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d="M8.25 5.6v12.8L18.5 12 8.25 5.6Z" />
                  </svg>
                </span>
                <span className="video-tile__meta">
                  <strong title={video.fileName}>{video.fileName}</strong>
                  <span>{formatByteLength(video.byteLength)}</span>
                </span>
              </button>
              <button
                type="button"
                className="video-tile__remove"
                aria-label={`删除${label}`}
                title={`删除${label}`}
                onClick={() => {
                  invalidatePreview();
                  onRemoveVideo(video.id);
                }}
              >
                删除
              </button>
            </div>
          );
        })}
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
  mediaRef: { current: { images: readonly ProductImage[]; videos: readonly ProductVideo[] } }
): boolean {
  if (!mountedRef.current || requestRef.current !== requestToken) {
    return false;
  }
  return kind === 'video'
    ? mediaRef.current.videos.some((video) => video.assetId === assetId)
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
