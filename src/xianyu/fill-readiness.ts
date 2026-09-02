import type { ProductDraft } from '../domain/product';
import type { ImageDownloadResult } from './fill';
import { findImageFileInput, findTextControl } from './dom';

export interface XianyuPublishFormWaitOptions {
  attempts: number;
  intervalMs: number;
}

const DEFAULT_PUBLISH_FORM_WAIT: XianyuPublishFormWaitOptions = {
  attempts: 60,
  intervalMs: 250
};

export function isXianyuPublishFormReady(document: Document): boolean {
  return (
    findImageFileInput(document) !== null &&
    findTextControl(
      document,
      ['textarea[name="description"]', 'textarea[placeholder*="描述"]', '[contenteditable="true"]'],
      '描述'
    ) !== null &&
    findTextControl(
      document,
      ['input[name="price"]', 'input[type="number"]', 'input[placeholder*="价格"]'],
      '价格'
    ) !== null
  );
}

export async function waitForXianyuPublishFormReady(
  isReady: () => boolean,
  wait: (delayMs: number) => Promise<void>,
  options: XianyuPublishFormWaitOptions = DEFAULT_PUBLISH_FORM_WAIT
): Promise<void> {
  for (let attempt = 0; attempt < options.attempts; attempt += 1) {
    if (isReady()) {
      return;
    }
    if (attempt + 1 < options.attempts) {
      await wait(options.intervalMs);
    }
  }
  throw new Error('闲鱼发布表单加载超时，请检查页面后重试');
}

export function validateDraftForFill(draft: ProductDraft): number {
  if (draft.title.trim().length === 0 || draft.description.trim().length === 0) {
    throw new Error('请先填写标题和描述');
  }
  if (draft.price === null || !Number.isFinite(draft.price) || draft.price <= 0) {
    throw new Error('请填写有效售价');
  }
  if (
    draft.originalPrice !== undefined &&
    (!Number.isFinite(draft.originalPrice) || draft.originalPrice <= 0)
  ) {
    throw new Error('请填写有效原价，或留空');
  }
  if (draft.images.some((image) => image.loadStatus !== 'loaded')) {
    throw new Error('请等待图片加载完成，或删除加载失败的图片');
  }
  if (draft.images.length === 0) {
    throw new Error('至少需要一张已加载的商品图片');
  }
  if (
    draft.shippingMethod === '一口价' &&
    (draft.shippingFee === undefined ||
      !Number.isFinite(draft.shippingFee) ||
      draft.shippingFee <= 0)
  ) {
    throw new Error('请选择有效的一口价邮费金额');
  }
  return draft.price;
}

export function requirePreparedImagesForFill(result: ImageDownloadResult): void {
  if (result.files.length === 0) {
    throw new Error('没有可填入的商品图片，请检查图片后重试');
  }
}
