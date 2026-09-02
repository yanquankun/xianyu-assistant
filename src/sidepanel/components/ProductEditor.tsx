import type { Ref } from 'react';

import {
  SHIPPING_METHODS,
  type ImageLoadStatus,
  type ProductDraft,
  type ShippingMethod
} from '../../domain/product';
import type { StoredMediaAsset } from '../../storage/media-store';
import { CustomSelect } from './CustomSelect';
import { MediaPicker } from './MediaPicker';

interface ProductEditorProps {
  draft: ProductDraft;
  descriptionValue: string;
  isDescriptionStreaming: boolean;
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
  tmall: '天猫来源',
  jd: '京东来源',
  generic: '其他来源'
};

const SHIPPING_OPTIONS = SHIPPING_METHODS.map((method) => ({ value: method, label: method }));

export function ProductEditor({
  draft,
  descriptionValue,
  isDescriptionStreaming,
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

  const updateShippingMethod = (value: string) => {
    if (!SHIPPING_METHODS.some((method) => method === value)) {
      return;
    }
    const shippingMethod = value as ShippingMethod;
    const nextDraft = { ...draft, shippingMethod, updatedAt: new Date().toISOString() };
    if (value !== '一口价') {
      delete nextDraft.shippingFee;
    }
    onChange(nextDraft);
  };

  const updateShippingFee = (value: string) => {
    const nextDraft = { ...draft, updatedAt: new Date().toISOString() };
    const amount = Number(value);
    if (value.length === 0 || !Number.isFinite(amount) || amount <= 0) {
      delete nextDraft.shippingFee;
    } else {
      nextDraft.shippingFee = amount;
    }
    onChange(nextDraft);
  };

  const priceWarning = draft.warnings.find((warning) => /售价|价格/u.test(warning));
  const imageWarning = draft.warnings.find((warning) => /商品图|图片/u.test(warning));

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
      {priceWarning === undefined ? null : (
        <p className="field-hint" role="status">
          {priceWarning}
        </p>
      )}

      <label className="field">
        <span>商品描述</span>
        <div className="description-input-frame">
          <textarea
            rows={8}
            value={descriptionValue}
            readOnly={isDescriptionStreaming}
            aria-label="商品描述"
            aria-busy={isDescriptionStreaming}
            onChange={(event) => update({ description: event.target.value })}
          />
          {isDescriptionStreaming ? (
            <div
              className={`description-polish-overlay${
                descriptionValue.length > 0 ? ' description-polish-overlay--typing' : ''
              }`}
              role="status"
              aria-label="AI 正在润色商品描述"
              aria-live="polite"
            >
              <span className="description-polish-indicator">
                <span className="description-polish-spinner" aria-hidden="true" />
                <span>{descriptionValue.length > 0 ? '正在生成…' : '等待 AI 响应…'}</span>
              </span>
            </div>
          ) : null}
        </div>
      </label>

      <div className="field-row">
        <CustomSelect
          label="发货方式"
          value={draft.shippingMethod}
          options={SHIPPING_OPTIONS}
          onChange={updateShippingMethod}
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

      <div className="shipping-options">
        {draft.shippingMethod === '一口价' ? (
          <label className="field">
            <span>邮费金额</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={draft.shippingFee ?? ''}
              onChange={(event) => updateShippingFee(event.target.value)}
            />
          </label>
        ) : null}
        <label className="shipping-pickup">
          <input
            type="checkbox"
            checked={draft.supportsPickup}
            onChange={(event) => update({ supportsPickup: event.target.checked })}
          />
          <span>支持自提</span>
        </label>
      </div>

      <div className="field">
        <span>商品媒体</span>
        {draft.images.length === 0 ? (
          <p className="field-hint field-hint--required" role="status">
            至少添加一张已加载的商品图片后才能填入闲鱼
          </p>
        ) : null}
        {imageWarning === undefined ? null : (
          <p className="field-hint" role="status">
            {imageWarning}
          </p>
        )}
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
