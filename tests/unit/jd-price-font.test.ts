import { Font, Glyph } from 'opentype.js';
import { describe, expect, it, vi } from 'vitest';

import {
  createOpenTypeGlyphResolver,
  decodePrivatePrice
} from '../../src/parsers/jd-price-font';

describe('decodePrivatePrice', () => {
  const names = new Map([
    ['\uE184', 'one'],
    ['\uEE94', 'eight'],
    ['\uE1AF', 'zero']
  ]);
  const resolver = { glyphNameFor: (character: string) => names.get(character) };

  it('通过私有字符的标准数字字形名解码价格', () => {
    expect(decodePrivatePrice('¥\uE184\uEE94\uEE94\uE184.\uE1AF\uE1AF', resolver)).toBe(1881);
  });

  it.each([
    '¥\uE184\uFFFF',
    '¥1.2.3',
    '¥1.234',
    '¥0.00',
    '¥-1.00',
    '¥1元'
  ])('拒绝无法确定或不符合价格格式的内容：%s', (value) => {
    expect(decodePrivatePrice(value, resolver)).toBeNull();
  });
});

describe('createOpenTypeGlyphResolver', () => {
  it.each([
    'http://spider-font-oss.360buyimg.com/font.otf',
    'https://example.com/font.otf',
    'https://spider-font-oss.360buyimg.com.evil.example/font.otf',
    'https://user:pass@spider-font-oss.360buyimg.com/font.otf'
  ])('拒绝非白名单字体地址且不发起请求：%s', async (fontUrl) => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(createOpenTypeGlyphResolver(fontUrl, fetchImpl)).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('限制响应状态、声明长度和实际字体大小', async () => {
    const url = 'https://spider-font-oss.360buyimg.com/font.otf';
    const failedFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
    await expect(createOpenTypeGlyphResolver(url, failedFetch)).rejects.toThrow();

    const declaredTooLarge = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Uint8Array(1), { headers: { 'Content-Length': '131073' } })
    );
    await expect(createOpenTypeGlyphResolver(url, declaredTooLarge)).rejects.toThrow();

    const actualTooLarge = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(new Uint8Array(131_073)));
    await expect(createOpenTypeGlyphResolver(url, actualTooLarge)).rejects.toThrow();
  });

  it('使用无凭据、无来源策略加载字体并返回窄字形解析器', async () => {
    const font = new Font({
      familyName: 'TestPrice',
      styleName: 'Regular',
      unitsPerEm: 1_000,
      ascender: 800,
      descender: -200,
      glyphs: [
        new Glyph({ name: '.notdef', unicode: 0, advanceWidth: 500 }),
        new Glyph({ name: 'one', unicode: 0xe184, advanceWidth: 500 })
      ]
    });
    const buffer = font.toArrayBuffer();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(buffer, { headers: { 'Content-Length': String(buffer.byteLength) } }));

    const resolver = await createOpenTypeGlyphResolver(
      'https://spider-font-oss.360buyimg.com/font.otf',
      fetchImpl
    );

    expect(resolver.glyphNameFor('\uE184')).toBe('one');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://spider-font-oss.360buyimg.com/font.otf',
      { credentials: 'omit', referrerPolicy: 'no-referrer' }
    );
  });
});
