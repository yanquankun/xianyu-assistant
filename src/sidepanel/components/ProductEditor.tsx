import type { ProductDraft } from '../../domain/product';
import { ImagePicker } from './ImagePicker';

interface ProductEditorProps {
  draft: ProductDraft;
  onChange: (draft: ProductDraft) => void;
  onImageToggle: (id: string) => void;
  onImageLoadStatus: (id: string, status: ProductDraft['images'][number]['loadStatus']) => void;
}

const PLATFORM_LABELS: Record<ProductDraft['platform'], string> = {
  taobao: '淘宝来源',
  jd: '京东来源',
  generic: '其他来源'
};

const CONFIDENCE_LABELS: Record<ProductDraft['confidence'], string> = {
  high: '高',
  medium: '中',
  low: '低'
};

export function ProductEditor({
  draft,
  onChange,
  onImageToggle,
  onImageLoadStatus
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
        <span className={`confidence confidence--${draft.confidence}`}>
          {CONFIDENCE_LABELS[draft.confidence]}
        </span>
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
        <label className="field">
          <span>发货方式</span>
          <select
            value={draft.shippingMethod}
            onChange={(event) => update({ shippingMethod: event.target.value })}
          >
            <option value="包邮">包邮</option>
            <option value="邮费另议">邮费另议</option>
            <option value="无需邮寄">无需邮寄</option>
          </select>
        </label>
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
        <span>选择商品图片</span>
        <ImagePicker
          images={draft.images}
          onToggle={onImageToggle}
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
