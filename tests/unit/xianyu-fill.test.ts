import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ProductImage } from '../../src/domain/product';
import {
  downloadSelectedImages,
  fillXianyuDraft,
  type XianyuFillPayload
} from '../../src/xianyu/fill';

function publishDocument(): Document {
  const html = readFileSync(
    resolve(process.cwd(), 'tests', 'fixtures', 'xianyu-publish.html'),
    'utf8'
  );
  return new DOMParser().parseFromString(html, 'text/html');
}

const validPayload: XianyuFillPayload = {
  title: '测试发布标题',
  description: '测试发布描述',
  price: 88.5,
  shippingMethod: '包邮',
  categoryNote: '',
  images: [
    {
      id: 'image-1',
      name: 'image-1.png',
      mimeType: 'image/png',
      dataBase64: 'aGVsbG8='
    }
  ]
};

describe('fillXianyuDraft', () => {
  it('填写标题、价格、描述和图片后不触发发布按钮', async () => {
    const document = publishDocument();
    const publish = document.querySelector<HTMLButtonElement>('[data-testid="publish"]');
    if (publish === null) {
      throw new Error('测试夹具需要发布按钮');
    }
    let clicked = false;
    publish.addEventListener('click', () => {
      clicked = true;
    });

    const result = await fillXianyuDraft(document, validPayload);

    expect(result.filled).toEqual(expect.arrayContaining(['title', 'price', 'description', 'images']));
    expect(document.querySelector<HTMLInputElement>('input[name="title"]')?.value).toBe(
      '测试发布标题'
    );
    expect(document.querySelector<HTMLInputElement>('input[name="price"]')?.value).toBe('88.5');
    expect(document.querySelector<HTMLTextAreaElement>('textarea[name="description"]')?.value).toBe(
      '测试发布描述'
    );
    expect(document.querySelector<HTMLInputElement>('input[name="images"]')?.files).toHaveLength(1);
    expect(clicked).toBe(false);
  });

  it('文本字段触发 input 和 change 事件', async () => {
    const document = publishDocument();
    const title = document.querySelector<HTMLInputElement>('input[name="title"]');
    if (title === null) {
      throw new Error('测试夹具需要标题输入框');
    }
    const events: string[] = [];
    title.addEventListener('input', () => events.push('input'));
    title.addEventListener('change', () => events.push('change'));

    await fillXianyuDraft(document, { ...validPayload, images: [] });

    expect(events).toEqual(['input', 'change']);
  });

  it('找不到字段时明确返回跳过项', async () => {
    const document = new DOMParser().parseFromString(
      '<!doctype html><html><body><main>空页面</main></body></html>',
      'text/html'
    );

    const result = await fillXianyuDraft(document, validPayload);

    expect(result.filled).toEqual([]);
    expect(result.skipped.map((item) => item.field)).toEqual([
      'title',
      'price',
      'description',
      'images'
    ]);
  });
});

describe('downloadSelectedImages', () => {
  const selectedImage: ProductImage = {
    id: 'selected',
    url: 'https://img.example.com/selected.png',
    source: 'open-graph',
    selected: true,
    loadStatus: 'loaded'
  };
  const images: ProductImage[] = [
    selectedImage,
    {
      id: 'ignored',
      url: 'https://img.example.com/ignored.png',
      source: 'open-graph',
      selected: false,
      loadStatus: 'loaded'
    }
  ];

  it('只下载已选择的有效图片并转换为可传输内容', async () => {
    const requested: string[] = [];
    const result = await downloadSelectedImages((input) => {
      requested.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png', 'content-length': '3' }
        })
      );
    }, images);

    expect(requested).toEqual(['https://img.example.com/selected.png']);
    expect(result.files).toEqual([
      {
        id: 'selected',
        name: 'selected.png',
        mimeType: 'image/png',
        dataBase64: 'AQID'
      }
    ]);
    expect(result.failures).toEqual([]);
  });

  it.each([
    ['text/html', '图片响应类型不受支持'],
    ['image/svg+xml', '图片响应类型不受支持']
  ])('拒绝不支持的 MIME 类型 %s', async (mimeType, expectedMessage) => {
    const result = await downloadSelectedImages(
      () => Promise.resolve(new Response('invalid', { headers: { 'content-type': mimeType } })),
      [selectedImage]
    );

    expect(result.files).toEqual([]);
    expect(result.failures[0]?.message).toContain(expectedMessage);
  });

  it('拒绝超过单张上限的图片', async () => {
    const result = await downloadSelectedImages(
      () =>
        Promise.resolve(
          new Response(new Uint8Array([1]), {
            headers: { 'content-type': 'image/jpeg', 'content-length': '10485761' }
          })
        ),
      [selectedImage]
    );

    expect(result.files).toEqual([]);
    expect(result.failures[0]?.message).toContain('图片超过 10 MB 上限');
  });
});
