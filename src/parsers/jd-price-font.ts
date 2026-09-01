import { parse } from 'opentype.js';

const MAX_FONT_BYTES = 131_072;
const ALLOWED_FONT_HOST = 'spider-font-oss.360buyimg.com';

const DIGIT_BY_GLYPH_NAME: Readonly<Record<string, string>> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9'
};

export interface GlyphNameResolver {
  glyphNameFor(character: string): string | undefined;
}

function validateFontUrl(fontUrl: string): URL {
  let url: URL;
  try {
    url = new URL(fontUrl);
  } catch {
    throw new Error('京东价格字体地址无效');
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== ALLOWED_FONT_HOST ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.port.length > 0
  ) {
    throw new Error('京东价格字体地址不在允许范围内');
  }
  return url;
}

export async function createOpenTypeGlyphResolver(
  fontUrl: string,
  fetchImpl: typeof fetch
): Promise<GlyphNameResolver> {
  const url = validateFontUrl(fontUrl);
  const response = await fetchImpl(url.href, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer'
  });
  if (!response.ok) {
    throw new Error('京东价格字体请求失败');
  }
  const declaredLength = response.headers.get('Content-Length');
  if (declaredLength !== null) {
    const byteLength = Number(declaredLength);
    if (Number.isFinite(byteLength) && byteLength > MAX_FONT_BYTES) {
      throw new Error('京东价格字体超过大小限制');
    }
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_FONT_BYTES) {
    throw new Error('京东价格字体超过大小限制');
  }
  const font = parse(buffer);
  return {
    glyphNameFor(character: string): string | undefined {
      return font.charToGlyph(character).name ?? undefined;
    }
  };
}

function isPrivateUseCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return (
    codePoint !== undefined &&
    ((codePoint >= 0xe000 && codePoint <= 0xf8ff) ||
      (codePoint >= 0xf0000 && codePoint <= 0xffffd) ||
      (codePoint >= 0x100000 && codePoint <= 0x10fffd))
  );
}

export function decodePrivatePrice(text: string, resolver: GlyphNameResolver): number | null {
  const input = text.replace(/[¥￥,\s]/gu, '');
  let decoded = '';
  for (const character of input) {
    if (/\d/u.test(character) || character === '.') {
      decoded += character;
      continue;
    }
    if (!isPrivateUseCharacter(character)) {
      return null;
    }
    const glyphName = resolver.glyphNameFor(character);
    const digit = glyphName === undefined ? undefined : DIGIT_BY_GLYPH_NAME[glyphName];
    if (digit === undefined) {
      return null;
    }
    decoded += digit;
  }
  if (!/^\d+(?:\.\d{1,2})?$/u.test(decoded)) {
    return null;
  }
  const amount = Number(decoded);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}
