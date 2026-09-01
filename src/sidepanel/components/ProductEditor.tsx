import type { Ref } from 'react';

import type { ImageLoadStatus, ProductDraft } from '../../domain/product';
import type { StoredMediaAsset } from '../../storage/media-store';
import { CustomSelect } from './CustomSelect';
import { MediaPicker } from './MediaPicker';

interface ProductEditorProps {
  draft: ProductDraft;
  onChange: (draft: ProductDraft) => void;
  onImageLoadStatus: (id: string, status: ImageLoadStatus) => void;
  resolveLocalAsset: (assetId: string) => Promise<StoredMediaAsset | null>;
  isUploadingImages: boolean;
  isUploadingVideos: boolean;
  onUploadImages: (files: readonly File[]) => void;
  onUploadVideos: (files: readonly File[]) => void;
  onRemoveImage: (id: string) => void;
  onRemoveVideo: (id: string) => void;
  onReturnToStart: () => void;
  returnToStartButtonRef: Ref<HTMLButtonElement>;
}

const PLATFORM_LABELS: Record<ProductDraft['platform'], string> = {
  taobao: '淘宝来源',
  jd: '京东来源',
  generic: '其他来源'
};

const SHIPPING_OPTIONS = [
  { value: '包邮', label: '包邮' },
  { value: '邮费另议', label: '邮费另议' },
  { value: '无需邮寄', label: '无需邮寄' }
] as const;

export function ProductEditor({
  draft,
  onChange,
  onImageLoadStatus,
  resolveLocalAsset,
  isUploadingImages,
  isUploadingVideos,
  onUploadImages,
  onUploadVideos,
  onRemoveImage,
  onRemoveVideo,
  onReturnToStart,
  returnToStartButtonRef
}: ProductEditorProps) {
  const update = (changes: Partial<ProductDraft>) => {
    onChange({ ...draft, ...changes, updatedAt: new Date().toISOString() });
  };

  const updateOriginalPrice = (value: string) => {
    const nextDraft = { ...draft, updatedAt: new Date().toISOString() };
    const amount = Number(value);
    if (value.length === 0 || !Number.isFinite(amount) || amount <= 0) {
      delete nextDraft.originalPrice;
    } else {
      nextDraft.originalPrice = amount;
    }
    onChange(nextDraft);
  };

  return (
    <section className="editor-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">
            {draft.canonicalUrl.length === 0 ? '手动输入' : PLATFORM_LABELS[draft.platform]}
          </span>
          <h2>编辑发布内容</h2>
        </div>
        <div className="editor-heading-actions">
          <button
            ref={returnToStartButtonRef}
            className="button button--quiet"
            type="button"
            onClick={onReturnToStart}
          >
            返回选择方式
          </button>
          <span className="step-number">02</span>
        </div>
      </div>

      <label className="field">
        <span>商品标题</span>
        <input
          value={draft.title}
          maxLength={60}
          onChange={(event) => update({ title: event.target.value })}
        />
      </label>

      <div className="field-row">
        <label className="field">
          <span>售价</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={draft.price ?? ''}
            onChange={(event) =>
              update({ price: event.target.value.length === 0 ? null : Number(event.target.value) })
            }
          />
        </label>
        <label className="field">
          <span>原价</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={draft.originalPrice ?? ''}
            onChange={(event) => updateOriginalPrice(event.target.value)}
          />
        </label>
      </div>

      <label className="field">
        <span>商品描述</span>
        <textarea
          rows={8}
          value={draft.description}
          onChange={(event) => update({ description: event.target.value })}
        />
      </label>

      <div className="field-row">
        <CustomSelect
          label="发货方式"
          value={draft.shippingMethod}
          options={SHIPPING_OPTIONS}
          onChange={(shippingMethod) => update({ shippingMethod })}
        />
        <label className="field">
          <span>分类备注</span>
          <input
            value={draft.categoryNote}
            placeholder="供发布时参考"
            onChange={(event) => update({ categoryNote: event.target.value })}
          />
        </label>
      </div>

      <div className="field">
        <span>商品媒体</span>
        <MediaPicker
          images={draft.images}
          videos={draft.videos}
          isUploadingImages={isUploadingImages}
          isUploadingVideos={isUploadingVideos}
          resolveLocalAsset={resolveLocalAsset}
          onUploadImages={onUploadImages}
          onUploadVideos={onUploadVideos}
          onRemoveImage={onRemoveImage}
          onRemoveVideo={onRemoveVideo}
          onLoadStatus={onImageLoadStatus}
        />
      </div>

      {draft.warnings.length > 0 ? (
        <ul className="warning-list">
          {draft.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
