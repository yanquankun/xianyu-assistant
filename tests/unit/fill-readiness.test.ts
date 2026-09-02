import { describe, expect, it } from 'vitest';

import type { ProductDraft } from '../../src/domain/product';
import {
  isXianyuPublishFormReady,
  requirePreparedImagesForFill,
  validateDraftForFill,
  waitForXianyuPublishFormReady
} from '../../src/xianyu/fill-readiness';

const draft: ProductDraft = {
  id: 'draft-ready',
  platform: 'jd',
  canonicalUrl: 'https://item.jd.com/1.html',
  source: { title: '来源标题', description: '来源描述', price: 99, currency: 'CNY' },
  title: '可发布标题',
  description: '可发布描述',
  price: 88,
  originalPrice: 99,
  currency: 'CNY',
  images: [
    {
      id: 'image-1',
      location: {
        kind: 'remote',
        url: 'https://img.example.com/one.jpg',
        extractedBy: 'platform-gallery'
      },
      loadStatus: 'loaded'
    }
  ],
  videos: [],
  warnings: [],
  confidence: 'high',
  shippingMethod: '包邮',
  supportsPickup: false,
  categoryNote: '',
  updatedAt: '2026-09-02T10:00:00.000Z'
};

describe('fill readiness', () => {
  it('闲鱼页面异步挂载发布表单后继续首次填入', async () => {
    const document = new DOMParser().parseFromString(
      '<!doctype html><html><body><main>加载中</main></body></html>',
      'text/html'
    );
    const waits: number[] = [];

    const ready = waitForXianyuPublishFormReady(
      () => isXianyuPublishFormReady(document),
      (delayMs) => {
        waits.push(delayMs);
        document.body.insertAdjacentHTML(
          'beforeend',
          '<textarea name="description"></textarea><input name="price"><input name="file" type="file" accept="image/png" multiple>'
        );
        return Promise.resolve();
      },
      { attempts: 2, intervalMs: 25 }
    );

    await expect(ready).resolves.toBeUndefined();
    expect(waits).toEqual([25]);
  });

  it('后台填表前要求至少一张已加载图片', () => {
    expect(() => validateDraftForFill({ ...draft, images: [] })).toThrow(
      '至少需要一张已加载的商品图片'
    );
  });

  it('一口价必须配置有效邮费', () => {
    expect(() => validateDraftForFill({ ...draft, shippingMethod: '一口价' })).toThrow(
      '请选择有效的一口价邮费金额'
    );
  });

  it('图片准备后仍为空时阻止填表', () => {
    expect(() => requirePreparedImagesForFill({ files: [], failures: [] })).toThrow(
      '没有可填入的商品图片，请检查图片后重试'
    );
  });

  it('有效草稿返回待填入售价', () => {
    expect(validateDraftForFill(draft)).toBe(88);
    expect(() =>
      requirePreparedImagesForFill({
        files: [{ id: 'image-1', name: 'one.jpg', mimeType: 'image/jpeg', dataBase64: 'AA==' }],
        failures: []
      })
    ).not.toThrow();
  });
});
