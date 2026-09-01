import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isProductPageReadiness,
  waitForProductPageReady,
  type ProductPageReadiness
} from '../../src/background/product-readiness';
import { checkProductPageReadiness } from '../../src/parsers/common';

function htmlDocument(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('checkProductPageReadiness', () => {
  it('只有商品路由但尚无商品证据时继续等待', () => {
    expect(
      checkProductPageReadiness(
        htmlDocument('<html><head><title>商品详情</title></head><body></body></html>'),
        'https://item.jd.com/100.html'
      )
    ).toEqual({ state: 'waiting' });
  });

  it('JSON-LD 中出现 Product 时判定就绪', () => {
    const document = htmlDocument(`
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"Product","name":"商品"}
      </script>
    `);

    expect(checkProductPageReadiness(document, 'https://item.jd.com/100.html')).toEqual({
      state: 'ready'
    });
  });

  it.each([
    [
      '淘宝',
      'https://item.taobao.com/item.htm?id=1',
      '<div data-title="product-title">商品</div>'
    ],
    [
      '天猫',
      'https://detail.tmall.com/item.htm?id=1',
      '<div id="J_DetailMeta"><h1 data-spm="1000983">商品</h1></div>'
    ],
    ['京东', 'https://item.jd.com/1.html', '<div class="sku-name">商品</div>']
  ])('%s 页面出现平台商品标记时判定就绪', (_name, url, html) => {
    expect(checkProductPageReadiness(htmlDocument(html), url)).toEqual({ state: 'ready' });
  });

  it('严格嵌入商品状态出现时判定京东页面就绪', () => {
    const document = htmlDocument(
      '<script>window._itemOnly = {"item":{"skuId":"100","name":"商品"}};</script>'
    );

    expect(checkProductPageReadiness(document, 'https://item.jd.com/100.html')).toEqual({
      state: 'ready'
    });
  });

  it('登录或安全验证页立即返回终止失败', () => {
    expect(
      checkProductPageReadiness(
        htmlDocument('<html><head><title>请完成安全验证</title></head><body></body></html>'),
        'https://passport.jd.com/login'
      )
    ).toEqual({
      state: 'failed',
      code: 'VERIFICATION_REQUIRED',
      message: '商品页面需要登录或安全验证'
    });
  });
});

describe('waitForProductPageReady', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('持续轮询，直到页面返回 ready', async () => {
    const states: ProductPageReadiness[] = [
      { state: 'waiting' },
      { state: 'waiting' },
      { state: 'ready' }
    ];
    const probe = vi.fn(() =>
      Promise.resolve<ProductPageReadiness>(states.shift() ?? { state: 'ready' })
    );
    const result = waitForProductPageReady(probe, { intervalMs: 250, timeoutMs: 1_000 });

    await vi.advanceTimersByTimeAsync(499);
    expect(probe).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toBeUndefined();
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it('终止失败会立即抛出原始页面错误，不再轮询', async () => {
    const probe = vi.fn(() =>
      Promise.resolve<ProductPageReadiness>({
        state: 'failed',
        code: 'HTTP_403',
        message: '商品页面返回 HTTP 403 错误'
      })
    );

    await expect(waitForProductPageReady(probe)).rejects.toThrow(
      '商品页面返回 HTTP 403 错误'
    );
    expect(probe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('超时后返回明确的语义就绪错误', async () => {
    const result = waitForProductPageReady(
      () => Promise.resolve({ state: 'waiting' }),
      { intervalMs: 250, timeoutMs: 1_000 }
    );
    const expectation = expect(result).rejects.toThrow(
      '商品页面尚未准备完成，请稍后重试'
    );

    await vi.advanceTimersByTimeAsync(1_000);
    await expectation;
  });
});

describe('isProductPageReadiness', () => {
  it('只接受约定的就绪状态结构', () => {
    expect(isProductPageReadiness({ state: 'ready' })).toBe(true);
    expect(
      isProductPageReadiness({
        state: 'failed',
        message: '商品页面不可用',
        code: 'PAGE_ERROR'
      })
    ).toBe(true);
    expect(isProductPageReadiness({ state: 'ready', product: { title: '越权字段' } })).toBe(false);
    expect(isProductPageReadiness({ state: 'failed', message: '', code: 'PAGE_ERROR' })).toBe(false);
  });
});
