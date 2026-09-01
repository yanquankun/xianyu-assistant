# 淘宝、天猫与京东商品解析增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立字段级证据解析管线，稳定区分淘宝、天猫和京东，并从真实京东移动商品页可靠提取当前商品标题、条件售价、显式原价、描述和最多 9 张商品图。

**Architecture:** 输入先归一化为“最终平台、域名族、商品身份”，页面解析器再分别采集通用结构化证据和平台证据，最后由字段合并器按当前商品/SKU、语义标签和可信度生成草稿。京东私有价格使用页面提供的动态 OTF 字体 `cmap` 与字形名做确定性解码；短链解析后按商品身份复用已有标签页，并在 URL 稳定后继续等待商品语义就绪。

**Tech Stack:** TypeScript 6、WXT 0.21、Chrome Extension Manifest V3、React 19、Vitest 4、Playwright、`opentype.js@2.0.0`、`@types/opentype.js@1.3.10`

**Spec:** `docs/superpowers/specs/2026-09-01-multiplatform-product-extraction-design.md`

## Global Constraints

- `ProductPlatform` 必须是 `'taobao' | 'tmall' | 'jd' | 'generic'`，天猫不能继续保存为淘宝。
- 淘宝和天猫共享 `e.tb.cn` 安全域名族，但最终平台必须由稳定后的正式商品页确定。
- AI 不得生成或修补售价、原价、商品标识和媒体 URL。
- 不读取推荐商品、猜你喜欢、评价图、店铺图或其他规格补齐当前商品字段。
- 来源商品视频不进入 `ParsedProduct` 或草稿；图片最多 9 张。
- 页面内嵌状态必须通过严格 JSON 解析，禁止 `eval`、`Function` 或执行页面脚本。
- 京东字体只允许 HTTPS 的 `spider-font-oss.360buyimg.com`，响应上限 128 KiB；字体解析失败时售价为空并产生警告。
- 不读取 Cookie、账号、本地存储或订单信息，不记录完整 DOM、脚本、私有字体或分享参数。
- 不自动点击闲鱼最终发布按钮。
- 每个任务先写失败测试，再做最小实现；不顺带重构 AI、闲鱼填表或媒体上传模块。

---

### Task 1: 独立平台类型、域名族、商品身份与旧草稿迁移

**Files:**
- Create: `src/domain/product-url.ts`
- Modify: `src/domain/product.ts:1-55`
- Modify: `src/domain/messages.ts:45-280`
- Modify: `src/background/permissions.ts:1-117`
- Modify: `src/background/product-input.ts:1-46`
- Modify: `src/storage/local-store.ts:38-67`
- Modify: `src/storage/operation-log.ts:71-143`
- Create: `tests/unit/product-identity.test.ts`
- Modify: `tests/unit/permissions.test.ts:12-128`
- Modify: `tests/unit/product-input.test.ts:5-60`
- Modify: `tests/unit/messages.test.ts:106-230`
- Modify: `tests/unit/storage.test.ts:101-177`
- Modify: `tests/unit/operation-log.test.ts`
- Modify: `tests/unit/operation-log-factory.test.ts`

**Interfaces:**
- Produces: `ProductDomainFamily`, `ProductIdentity`, `classifyProductHost(hostname)`, `parseProductIdentity(input)`, `sameProductIdentity(left, right)`, `sanitizeProductLogUrl(input)` and the `domainFamily`/`isShortLink` fields on `NormalizedUrl`.
- Consumes: only the platform URL itself; no DOM or page state.

- [ ] **Step 1: Write failing platform and identity tests**

Add exact expectations covering final platforms, short-link families, tracking removal, optional SKU and incompatible variants:

```ts
it.each([
  ['https://item.taobao.com/item.htm?id=123&utm_source=share', 'taobao', '123'],
  ['https://detail.tmall.com/item.htm?id=456&skuId=789&spm=a1', 'tmall', '456'],
  ['https://item.jd.com/101.html?utm_source=ios', 'jd', '101'],
  ['https://item.m.jd.com/product/202.html?jkl=@code@', 'jd', '202']
] as const)('提取 %s 的平台和商品主标识', (input, platform, productId) => {
  expect(parseProductIdentity(input)).toMatchObject({ platform, productId });
});

expect(classifyProductHost('e.tb.cn')).toEqual({
  platformHint: 'taobao',
  domainFamily: 'taobao-family',
  isShortLink: true
});
expect(normalizeHttpUrl('https://detail.tmall.com/item.htm?id=1').platform).toBe('tmall');

expect(
  sameProductIdentity(
    parseProductIdentity('https://detail.tmall.com/item.htm?id=1&skuId=2')!,
    parseProductIdentity('https://detail.tmall.com/item.htm?id=1&skuId=3')!
  )
).toBe(false);
```

Add a storage test with an otherwise valid legacy draft whose `platform` is `taobao` and `canonicalUrl` is `https://detail.tmall.com/item.htm?id=1`; expect `getDraft()` to return `platform: 'tmall'` and persist the migrated value. Add a second case with an empty or invalid canonical URL and assert it remains `taobao`.

Add operation-log expectations that `https://3.cn/short?jkl=@code@` is stored as `https://3.cn/short`, a formal product URL is stored as its canonical product URL, and credentials/tracking/hash never appear in a sanitized snapshot.

- [ ] **Step 2: Run the focused tests and verify the new cases fail**

Run:

```bash
pnpm vitest run tests/unit/product-identity.test.ts tests/unit/permissions.test.ts tests/unit/product-input.test.ts tests/unit/messages.test.ts tests/unit/storage.test.ts tests/unit/operation-log.test.ts tests/unit/operation-log-factory.test.ts
```

Expected: FAIL because `tmall`, `ProductDomainFamily` and identity helpers do not exist, and old Tmall drafts are returned as `taobao`.

- [ ] **Step 3: Implement the URL classifier and product identity**

Create the following public contracts in `src/domain/product-url.ts` so both background orchestration and storage sanitization can depend on a pure domain module:

```ts
import type { ProductPlatform } from '../domain/product';

export type ProductDomainFamily = 'taobao-family' | 'jd-family' | 'generic';

export interface ProductHostClassification {
  platformHint: ProductPlatform;
  domainFamily: ProductDomainFamily;
  isShortLink: boolean;
}

export interface ProductIdentity {
  platform: Exclude<ProductPlatform, 'generic'>;
  productId: string;
  skuId?: string;
  canonicalUrl: string;
}

export function classifyProductHost(hostname: string): ProductHostClassification;
export function parseProductIdentity(input: string | URL): ProductIdentity | null;
export function sameProductIdentity(left: ProductIdentity, right: ProductIdentity): boolean;
export function sanitizeProductLogUrl(input: string): string | undefined;
```

Implementation rules:

- Taobao/Tmall accept `/item.htm?id=<digits>`; JD accepts `item.jd.com/<digits>.html` and `item.m.jd.com/product/<digits>.html`.
- Read optional `skuId` or `sku_id` only when it is a non-empty digit string.
- Canonical URLs retain only `id` and an explicitly valid SKU parameter for Taobao/Tmall, and retain the JD product path without tracking/query/hash.
- `sameProductIdentity` requires the same platform and `productId`; when both identities contain `skuId`, they must also match.
- `e.tb.cn` and `3.cn` have a family and platform hint but return no `ProductIdentity` until redirected.
- `sanitizeProductLogUrl` strips credentials, hash and every query parameter from short links; known formal product URLs become `ProductIdentity.canonicalUrl`; unknown HTTP(S) URLs retain only non-sensitive parameters after removing authorization/token/key/tracking/share names.

Update `NormalizedUrl` to include `domainFamily` and `isShortLink`; use the domain family rather than platform equality in `ensureProductDestination`. This preserves `e.tb.cn → taobao.com/tmall.com` while still rejecting cross-family navigation.

- [ ] **Step 4: Add `tmall` validation and deterministic legacy migration**

Change every product platform whitelist in `src/domain/messages.ts` to:

```ts
const PRODUCT_PLATFORMS = ['taobao', 'tmall', 'jd', 'generic'] as const;
```

Before the early `isProductDraft(value)` return in `parseStoredProductDraft`, classify a valid canonical URL. If `value.platform === 'taobao'` and the URL host classifies as `tmall`, clone the draft with `platform: 'tmall'` and return `migrated: true`. If parsing fails or the host is not Tmall, preserve the original platform.

Replace the URL branch inside `sanitizeDraftSnapshot` with `sanitizeProductLogUrl`; the running draft may still retain `submittedUrl`, but operation logs must not retain share parameters.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
pnpm vitest run tests/unit/product-identity.test.ts tests/unit/permissions.test.ts tests/unit/product-input.test.ts tests/unit/messages.test.ts tests/unit/storage.test.ts tests/unit/operation-log.test.ts tests/unit/operation-log-factory.test.ts
pnpm typecheck
```

Expected: all focused tests PASS and TypeScript reports no missing `tmall` branches.

- [ ] **Step 6: Commit the platform foundation**

```bash
git add src/domain/product-url.ts src/domain/product.ts src/domain/messages.ts src/background/permissions.ts src/background/product-input.ts src/storage/local-store.ts src/storage/operation-log.ts tests/unit/product-identity.test.ts tests/unit/permissions.test.ts tests/unit/product-input.test.ts tests/unit/messages.test.ts tests/unit/storage.test.ts tests/unit/operation-log.test.ts tests/unit/operation-log-factory.test.ts
git commit -m "feat(parser): 区分天猫平台并规范商品身份"
```

---

### Task 2: 字段级证据模型、通用采集器和字段合并器

**Files:**
- Create: `src/parsers/evidence.ts`
- Modify: `src/domain/product.ts:5-25`
- Modify: `src/domain/messages.ts:55-125`
- Modify: `src/parsers/generic.ts:1-216`
- Modify: `src/parsers/merge.ts:1-128`
- Modify: `src/parsers/taobao.ts:1-28`
- Modify: `src/parsers/jd.ts:1-28`
- Modify: `src/parsers/common.ts:99-132`
- Modify: `tests/unit/parsers.test.ts:19-108`

**Interfaces:**
- Consumes: `ProductIdentity` from Task 1.
- Produces: `ProductEvidenceSet`, `collectGenericEvidence(document, context)`, `mergeEvidenceSets(...sets)` and `mergeProductEvidence(evidence, context)`.

- [ ] **Step 1: Write failing evidence-priority tests**

Add cases that prove fields are selected independently rather than by a whole-candidate priority:

```ts
it('分别选择高可信标题、价格、描述和图片', () => {
  const result = mergeProductEvidence(
    {
      titles: [
        { value: '页面标题 - 京东', source: 'meta', confidence: 'low', label: 'page-title' },
        { value: '当前 SKU 标题', source: 'embedded-state', confidence: 'high', skuId: '100' }
      ],
      descriptions: [{ value: '普通 meta 描述', source: 'meta', confidence: 'medium' }],
      prices: [
        { value: 2090, currency: 'CNY', kind: 'original', source: 'embedded-state', confidence: 'high', skuId: '100' },
        { value: 1881, currency: 'CNY', kind: 'conditional', source: 'embedded-state', confidence: 'high', skuId: '100', label: '到手价' }
      ],
      images: [{ value: 'https://img.example.com/a.jpg', source: 'platform-gallery', confidence: 'high', position: 0 }],
      canonicalUrls: [],
      warnings: []
    },
    { platform: 'jd', pageUrl: 'https://item.jd.com/100.html', productId: '100', skuId: '100' }
  );

  expect(result).toMatchObject({
    title: '当前 SKU 标题',
    description: '普通 meta 描述',
    price: 1881,
    originalPrice: 2090
  });
  expect(result.warnings).toContain('当前售价为到手价，请发布前核对适用条件');
});
```

Add tests for:

- `meta[name="description"]` is used when JSON-LD and OG descriptions are absent.
- `h1` without product semantics is ignored by the generic collector.
- a price bound to another SKU is ignored.
- a recommendation/gallery image marked with a different product ID is ignored.
- image identity deduplicates recognized JD/Ali CDN resize variants but keeps signed URLs from unknown hosts intact.
- an explicit original price at or below sale price is discarded with a warning.

- [ ] **Step 2: Run parser tests and verify they fail**

Run:

```bash
pnpm vitest run tests/unit/parsers.test.ts
```

Expected: FAIL because the evidence constructors and field-level merger do not exist and ordinary description Meta is not collected.

- [ ] **Step 3: Introduce the evidence contracts**

Create `src/parsers/evidence.ts` with these exact public types and constructors:

```ts
import type { ExtractionConfidence, ProductPlatform } from '../domain/product';

export type EvidenceSource =
  | 'json-ld'
  | 'open-graph'
  | 'meta'
  | 'semantic-dom'
  | 'embedded-state'
  | 'platform-gallery';

export interface EvidenceContext {
  platform: ProductPlatform;
  pageUrl: string;
  productId?: string;
  skuId?: string;
}

export interface FieldEvidence<T> {
  value: T;
  source: EvidenceSource;
  confidence: ExtractionConfidence;
  productId?: string;
  skuId?: string;
  label?: string;
}

export type PriceKind = 'sale' | 'original' | 'conditional' | 'unknown';

export interface PriceEvidence extends FieldEvidence<number> {
  currency: 'CNY';
  kind: PriceKind;
}

export interface ImageEvidence extends FieldEvidence<string> {
  highResolutionUrl?: string;
  position: number;
}

export interface ProductEvidenceSet {
  titles: FieldEvidence<string>[];
  descriptions: FieldEvidence<string>[];
  prices: PriceEvidence[];
  images: ImageEvidence[];
  canonicalUrls: FieldEvidence<string>[];
  warnings: string[];
}

export function createEvidenceSet(): ProductEvidenceSet;
export function mergeEvidenceSets(...sets: readonly ProductEvidenceSet[]): ProductEvidenceSet;
```

Extend `RemoteImageExtractionSource` to the same six `EvidenceSource` values so every persisted remote image keeps its real provenance.

- [ ] **Step 4: Replace candidate collection with generic evidence collection**

Rename `parseGeneric` to:

```ts
export function collectGenericEvidence(
  document: Document,
  context: EvidenceContext
): ProductEvidenceSet;
```

Keep strict `JSON.parse` for JSON-LD. Collect:

- JSON-LD `Product.name`, `description`, `offers.price`, `priceCurrency` and `image` as high-confidence structured evidence.
- OG title, description, product price/currency and images as medium-confidence evidence.
- `meta[name="description"]` as medium-confidence description evidence.
- `document.title` as low-confidence title with `label: 'page-title'`.
- generic semantic DOM only through `itemprop="name|description|price|image"`; do not query a bare `h1`.

Malformed JSON-LD adds exactly `页面结构化商品数据无法解析，已使用页面信息降级` and does not stop Meta collection.

- [ ] **Step 5: Implement field-specific ranking and safe image normalization**

Export:

```ts
export function mergeProductEvidence(
  evidence: ProductEvidenceSet,
  context: EvidenceContext
): ParsedProduct;
```

Use explicit ranks:

```ts
const TITLE_RANK = {
  'embedded-state': 500,
  'json-ld': 400,
  'semantic-dom': 300,
  'open-graph': 200,
  meta: 100,
  'platform-gallery': 0
} as const;

const DESCRIPTION_RANK = {
  'json-ld': 400,
  'open-graph': 300,
  meta: 200,
  'embedded-state': 100,
  'semantic-dom': 100,
  'platform-gallery': 0
} as const;
```

Before ranking, reject evidence whose explicit `productId` or `skuId` conflicts with the current context. For price, prefer current-SKU `sale`/`conditional`, preserve its label in a warning, and accept `original` only when greater than sale. For images, prefer `highResolutionUrl`, retain position order, filter non-HTTP(S), and stop after 9.

For recognized hosts ending in `.360buyimg.com`, `.alicdn.com` or `.tbcdn.cn`, derive duplicate identity from origin and normalized path while ignoring resize-only query/path variants; for unknown hosts retain the query in duplicate identity so signed resources are not collapsed incorrectly.

- [ ] **Step 6: Adapt current platform parsers to return evidence without adding new behavior**

Change the temporary contracts to:

```ts
export function collectTaobaoEvidence(document: Document, context: EvidenceContext): ProductEvidenceSet;
export function collectJdEvidence(document: Document, context: EvidenceContext): Promise<ProductEvidenceSet>;
```

At this task boundary, preserve the current verified title/ASCII-price selectors as `semantic-dom` evidence and return no platform images. `parseProductDocument` becomes asynchronous and merges generic plus platform evidence; Task 3 and Task 4 replace these minimal adapters with the complete implementations.

Update the test-local `parseFixture` helper to return the parser promise, and add `await` to every existing parser assertion so asynchronous JD evidence cannot be accidentally ignored.

- [ ] **Step 7: Run parser tests and typecheck**

Run:

```bash
pnpm vitest run tests/unit/parsers.test.ts tests/unit/messages.test.ts
pnpm typecheck
```

Expected: PASS; existing structured fixtures still produce the same valid fields and new field-priority cases pass.

- [ ] **Step 8: Commit the evidence pipeline**

```bash
git add src/parsers/evidence.ts src/domain/product.ts src/domain/messages.ts src/parsers/generic.ts src/parsers/merge.ts src/parsers/taobao.ts src/parsers/jd.ts src/parsers/common.ts tests/unit/parsers.test.ts
git commit -m "refactor(parser): 建立字段级商品证据管线"
```

---

### Task 3: 京东当前 SKU、动态字体价格和高清商品图库

**Files:**
- Create: `src/parsers/embedded-json.ts`
- Create: `src/parsers/jd-price-font.ts`
- Modify: `src/parsers/jd.ts`
- Modify: `src/parsers/common.ts`
- Modify: `entrypoints/product-extractor.ts:1-40`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `tests/unit/embedded-json.test.ts`
- Create: `tests/unit/jd-price-font.test.ts`
- Create: `tests/fixtures/jd-mobile-product.html`
- Modify: `tests/unit/parsers.test.ts`

**Interfaces:**
- Consumes: evidence contracts and product identity from Tasks 1–2.
- Produces: `extractAssignedJsonObject`, `createOpenTypeGlyphResolver`, `decodePrivatePrice` and a complete async `collectJdEvidence(document, context, dependencies)`.

- [ ] **Step 1: Add the exact font dependencies**

Run:

```bash
pnpm add opentype.js@2.0.0
pnpm add -D @types/opentype.js@1.3.10
```

Expected: `package.json` and `pnpm-lock.yaml` contain only these two new packages and their transitive dependencies. Do not use a CDN script at runtime.

- [ ] **Step 2: Write failing strict-JSON and private-font tests**

Test balanced object extraction with braces and escaped quotes inside strings, and ensure trailing executable code is never parsed:

```ts
const script = `window._itemInfo = ({"stock":{"skuId":"100"},"text":"} \\" safe"});alert(1)`;
expect(extractAssignedJsonObject(script, 'window._itemInfo')).toEqual({
  stock: { skuId: '100' },
  text: '} " safe'
});
expect(() => extractAssignedJsonObject('window._itemInfo = ({bad: 1})', 'window._itemInfo')).toThrow();
```

Test price decoding through a narrow resolver rather than a real copyrighted font fixture:

```ts
const names = new Map([
  ['\uE184', 'one'],
  ['\uEE94', 'eight'],
  ['\uE1AF', 'zero']
]);
expect(
  decodePrivatePrice('¥\uE184\uEE94\uEE94\uE184.\uE1AF\uE1AF', {
    glyphNameFor: (character) => names.get(character)
  })
).toBe(1881);
expect(decodePrivatePrice('¥\uE184\uFFFF', { glyphNameFor: () => undefined })).toBeNull();
```

- [ ] **Step 3: Implement strict embedded JSON extraction**

`extractAssignedJsonObject(scriptText, variableName)` must locate the exact assignment prefix, scan the first object with a brace depth counter that respects JSON strings and escapes, then call `JSON.parse` on that substring. It returns `Record<string, unknown> | null`; no JavaScript expression is evaluated.

Support the two observed assignments independently:

```ts
extractAssignedJsonObject(text, 'window._itemOnly');
extractAssignedJsonObject(text, 'window._itemInfo');
```

Only later JD code may read these whitelisted paths:

- `_itemOnly.item.skuId`, `skuName`, `image`.
- `_itemInfo.stock.skuId`, `realSkuId`.
- `_itemInfo.priceFloor.price`, `fontFamily`, `afterDesc.text`.
- `_itemInfo.priceFloor.ext.realPriceExt.ORIGINAL.salePrice` and `ext.jdPrice` for cross-checking explicit original price.

- [ ] **Step 4: Implement bounded dynamic-font decoding**

Create these public contracts:

```ts
export interface GlyphNameResolver {
  glyphNameFor(character: string): string | undefined;
}

export async function createOpenTypeGlyphResolver(
  fontUrl: string,
  fetchImpl: typeof fetch
): Promise<GlyphNameResolver>;

export function decodePrivatePrice(
  text: string,
  resolver: GlyphNameResolver
): number | null;
```

The JD adapter dependency is explicit and narrow:

```ts
export interface JdEvidenceDependencies {
  loadPriceFont(fontUrl: string): Promise<GlyphNameResolver>;
}

export function collectJdEvidence(
  document: Document,
  context: EvidenceContext,
  dependencies: JdEvidenceDependencies
): Promise<ProductEvidenceSet>;
```

`parseProductDocument` accepts `{ fetch: typeof fetch }` as a parser dependency and supplies `loadPriceFont: (url) => createOpenTypeGlyphResolver(url, fetchImpl)`. Adapter unit tests pass a deterministic fake resolver directly.

`createOpenTypeGlyphResolver` must:

- parse the URL and require `https:` plus hostname `spider-font-oss.360buyimg.com`;
- fetch with `credentials: 'omit'` and `referrerPolicy: 'no-referrer'`;
- reject non-2xx responses, `Content-Length > 131072`, or an actual buffer over 131072 bytes;
- call `parse(arrayBuffer)` from the bundled `opentype.js` package;
- return `font.charToGlyph(character).name` through the narrow resolver.

`decodePrivatePrice` accepts ASCII digits, one decimal point and private characters whose glyph names are exactly `zero` through `nine`. It rejects unknown glyphs, multiple decimals, non-positive values and more than two decimal digits.

- [ ] **Step 5: Encode the observed JD mobile page shape as an anonymous fixture**

Create a fixture with no real shop/account/tracking values, but preserve this exact structure:

```html
<style>
  @font-face {
    font-family: 'JDZH-Regular-Price';
    src: url('https://spider-font-oss.360buyimg.com/test-price.otf') format('truetype');
  }
</style>
<script>
window._itemOnly = ({"item":{"skuId":"100","skuName":"京东当前商品","image":["jfs/a.jpg","jfs/b.jpg"]}});
window._itemInfo = ({
  "priceFloor":{"price":"\uE184\uEE94\uEE94\uE184.\uE1AF\uE1AF","fontFamily":"JDZH-Regular-Price","afterDesc":{"text":"到手价"},"ext":{"jdPrice":"2090.00","realPriceExt":{"ORIGINAL":{"salePrice":"2090.00"}}}},
  "stock":{"skuId":"100","realSkuId":"100"}
});
</script>
<div id="priceFloor"><span id="main_price">¥<em>&#xE184;&#xEE94;&#xEE94;&#xE184;</em><span>.&#xE1AF;&#xE1AF;</span><span>到手价</span></span></div>
<ul id="loopImgUl">
  <li data-type="video"><img back_src="https://img.example.com/video-cover.jpg"></li>
  <li><img back_src="https://img10.360buyimg.com/n1/jfs/a.jpg"></li>
  <li><img back_src="https://img10.360buyimg.com/n1/jfs/b.jpg"></li>
</ul>
```

The test injects a fake `GlyphNameResolver`, then expects title `京东当前商品`, price `1881`, original price `2090`, a conditional-price warning, exactly two ordered images, and no video cover.

- [ ] **Step 6: Implement `collectJdEvidence`**

Use URL product identity plus `_itemOnly.item.skuId` and `_itemInfo.stock.skuId`; if any explicit IDs conflict, discard platform price/title/gallery evidence and append `京东页面商品标识不一致，已放弃平台专用字段`.

For price:

1. Prefer an ASCII numeric value in the current `#main_price` region when present.
2. Otherwise read `priceFloor.price`, locate the matching `@font-face` URL through CSSOM/inline styles, load the allowed OTF and decode its glyph names.
3. Use `priceFloor.afterDesc.text` as the condition label; `到手价` produces `kind: 'conditional'`.
4. Read original price only through `realPriceExt.ORIGINAL.salePrice`; require it to equal `ext.jdPrice` when both exist and to be greater than the decoded sale price.
5. A font fetch/parse/decode failure adds `京东价格使用动态字体且无法可靠解码，请手动填写售价` and does not use `2090` as sale price.

For images, first cross-check `#loopImgUl` entries against `_itemOnly.item.image`, prefer `back_src`, exclude entries marked video, and normalize the JD CDN URL. If the DOM gallery is absent, construct ordered CDN candidates from the whitelisted item image paths. Stop at 9 and never add a source video.

- [ ] **Step 7: Make the extractor async without weakening message validation**

`extractProductDocument` and `parseProductDocument` return promises. Update the unlisted script listener to:

```ts
void extractProductDocument(document, window.location.href, message.hintedTitle).then(
  sendResponse,
  (error: unknown) =>
    sendResponse({
      ok: false,
      error: { message: error instanceof Error ? error.message : '商品解析失败', code: 'PARSE_FAILED' }
    })
);
return true;
```

Do not include the font URL, page script text or glyph mapping in errors or logs.

- [ ] **Step 8: Run the JD-focused tests, typecheck and build**

Run:

```bash
pnpm vitest run tests/unit/embedded-json.test.ts tests/unit/jd-price-font.test.ts tests/unit/parsers.test.ts tests/unit/messages.test.ts
pnpm typecheck
pnpm build
```

Expected: all commands PASS; the generated extension bundle contains `opentype.js` locally and no remote executable script.

- [ ] **Step 9: Commit the JD adapter**

```bash
git add package.json pnpm-lock.yaml src/parsers/embedded-json.ts src/parsers/jd-price-font.ts src/parsers/jd.ts src/parsers/common.ts entrypoints/product-extractor.ts tests/unit/embedded-json.test.ts tests/unit/jd-price-font.test.ts tests/fixtures/jd-mobile-product.html tests/unit/parsers.test.ts
git commit -m "feat(jd): 解析动态字体价格和商品图库"
```

---

### Task 4: 淘宝与天猫独立适配器

**Files:**
- Create: `src/parsers/ali.ts`
- Create: `src/parsers/tmall.ts`
- Modify: `src/parsers/taobao.ts`
- Modify: `src/parsers/common.ts`
- Create: `tests/fixtures/tmall-product.html`
- Modify: `tests/fixtures/taobao-product.html`
- Modify: `tests/unit/parsers.test.ts`

**Interfaces:**
- Consumes: `EvidenceContext` and `ProductEvidenceSet` from Task 2.
- Produces: `collectTaobaoEvidence`, `collectTmallEvidence` backed by a shared `collectAliEvidence(document, context, selectors)` helper.

- [ ] **Step 1: Write failing platform-separation and safe-DOM tests**

Add tests asserting:

```ts
const tmall = await parseFixture('tmall-product.html', 'https://detail.tmall.com/item.htm?id=200');
expect(tmall.platform).toBe('tmall');
expect(tmall.title).toBe('天猫当前商品');

const unrelatedHeading = new DOMParser().parseFromString(
  '<h1>店铺活动标题</h1><div data-title="product-title">淘宝当前商品</div>',
  'text/html'
);
const result = await parseProductDocument(
  unrelatedHeading,
  'https://item.taobao.com/item.htm?id=100'
);
expect(result.title).toBe('淘宝当前商品');
```

Add a conditional-price case whose current product price region contains `到手价 ¥88.00` and an unrelated recommendation contains `¥1.00`; expect `88`, a condition warning, and no `1`. Add a gallery test with scoped lazy-loaded images and an out-of-scope recommendation image; expect only scoped current-product images.

- [ ] **Step 2: Run parser tests and verify they fail**

Run:

```bash
pnpm vitest run tests/unit/parsers.test.ts
```

Expected: FAIL because Tmall still follows the Taobao branch and there is no independent adapter.

- [ ] **Step 3: Implement the shared Ali evidence helper**

Define an internal selector contract rather than cloning the parser:

```ts
interface AliEvidenceSelectors {
  title: readonly string[];
  priceRegions: readonly string[];
  galleryRegions: readonly string[];
}

export function collectAliEvidence(
  document: Document,
  context: EvidenceContext,
  selectors: AliEvidenceSelectors
): ProductEvidenceSet;
```

Rules:

- Title selectors must resolve inside an explicit product title marker such as `[data-title="product-title"]`; do not fall back to a bare `h1`.
- Price must be read from a configured product price region. Detect `到手价`, `券后价` or `会员价` from that same region and mark it conditional.
- Original price only comes from a struck-through/`data-original-price` element in the same price region and only when greater than sale.
- Gallery images are collected only inside configured product gallery regions, prefer `data-src`, `data-lazy-src`, `data-lazyload-src` and `src` in that order, and exclude elements/ancestors marked recommendation, review, avatar or video.
- The helper receives the final context platform and never rewrites it.

Keep Taobao and Tmall selector configuration in their separate files. Selectors already present in the repository remain supported; every newly added selector must be exercised by the anonymous fixtures in this task.

- [ ] **Step 4: Route final Tmall pages to the Tmall adapter**

Update `src/parsers/common.ts` to select by final platform:

```ts
const platformEvidence =
  context.platform === 'taobao'
    ? collectTaobaoEvidence(document, context)
    : context.platform === 'tmall'
      ? collectTmallEvidence(document, context)
      : context.platform === 'jd'
        ? await collectJdEvidence(document, context, dependencies)
        : createEvidenceSet();
```

The platform in the merged result always comes from `context`, never from a short-link hint or candidate.

- [ ] **Step 5: Run parser and platform tests**

Run:

```bash
pnpm vitest run tests/unit/parsers.test.ts tests/unit/permissions.test.ts tests/unit/product-input.test.ts
pnpm typecheck
```

Expected: PASS; Taobao and Tmall share only the helper and domain family, while results retain distinct platform types.

- [ ] **Step 6: Commit the Ali adapters**

```bash
git add src/parsers/ali.ts src/parsers/taobao.ts src/parsers/tmall.ts src/parsers/common.ts tests/fixtures/taobao-product.html tests/fixtures/tmall-product.html tests/unit/parsers.test.ts
git commit -m "feat(parser): 分离淘宝与天猫商品适配器"
```

---

### Task 5: 解析质量门槛、错误码和字段警告

**Files:**
- Modify: `src/domain/product.ts:48-55`
- Modify: `src/domain/messages.ts:262-307`
- Modify: `src/parsers/common.ts`
- Modify: `src/storage/operation-log.ts`
- Modify: `src/background/operation-log-factory.ts:106-139`
- Modify: `src/sidepanel/state.ts:24-30,148-185`
- Modify: `src/sidepanel/components/ProductEditor.tsx:86-168`
- Modify: `src/sidepanel/components/OperationLog.tsx`
- Modify: `tests/unit/parsers.test.ts:110-247`
- Modify: `tests/unit/messages.test.ts:164-191`
- Modify: `tests/unit/operation-log.test.ts`
- Modify: `tests/unit/operation-log-factory.test.ts`
- Modify: `tests/unit/operation-log-component.test.tsx`
- Modify: `tests/unit/sidepanel-state.test.ts:150-190`
- Modify: `tests/unit/sidepanel-app.test.tsx`

**Interfaces:**
- Consumes: merged `ParsedProduct` from Tasks 2–4.
- Produces: strict extraction errors `TITLE_MISSING` and `PRODUCT_INCOMPLETE`; successful partial products only when exactly one of price/images is missing.

- [ ] **Step 1: Write failing quality-gate tests**

Replace the old expectation that a hinted title alone succeeds:

```ts
const result = await extractProductDocument(
  emptyDocument,
  'https://item.jd.com/100.html',
  '分享文案标题'
);
expect(result).toEqual({
  ok: false,
  error: {
    code: 'PRODUCT_INCOMPLETE',
    message: '仅识别到商品标题，售价和商品图均缺失，请重试或手动填写'
  }
});
```

Add these exact cases:

- no title but valid price/images → `TITLE_MISSING` and no product.
- title + price, no images → success with `未能可靠识别商品图片，请手动补充`.
- title + images, no price → success with `未能可靠识别售价，请手动填写`.
- title only → `PRODUCT_INCOMPLETE`.
- condition price → success and visible condition warning.

Add a parse-log test that uses distinctive title and description text, then asserts the stored entry contains neither value nor the submitted short-link query. It must contain only the final platform, sanitized canonical URL, field-completion booleans/count and warnings for the source extraction.

- [ ] **Step 2: Run focused tests and verify failures**

Run:

```bash
pnpm vitest run tests/unit/parsers.test.ts tests/unit/messages.test.ts tests/unit/operation-log.test.ts tests/unit/operation-log-factory.test.ts tests/unit/operation-log-component.test.tsx tests/unit/sidepanel-state.test.ts tests/unit/sidepanel-app.test.tsx
```

Expected: FAIL because title-only products currently return `ok: true` and field warnings are only generic.

- [ ] **Step 3: Apply quality gates after hinted-title handling**

The order in `extractProductDocument` must be:

1. detect page/login/verification errors;
2. parse and merge evidence;
3. apply a valid hinted title if allowed;
4. validate title;
5. validate the price/images combination.

Return only the two new safe errors above. Do not attach the partial product, DOM or evidence object to failure responses.

- [ ] **Step 4: Render field-local warnings using existing styles**

In `ProductEditor`, derive warning strings without adding state:

```ts
const priceWarning = draft.warnings.find((warning) => /售价|价格/u.test(warning));
const imageWarning = draft.warnings.find((warning) => /商品图|图片/u.test(warning));
```

Render `priceWarning` under the price row and `imageWarning` above `MediaPicker` with the existing `field-hint` class and `role="status"`. Keep the full warning list at the bottom for provenance/conflict warnings.

`PARSE_SUCCEEDED` continues to say `商品信息已解析，请检查并编辑`; incomplete extraction enters the existing `PARSE_FAILED` path and must not overwrite an existing draft.

- [ ] **Step 5: Restrict source-extraction logs to field completion**

Add the following operation-log structure while retaining `OperationDraftSnapshot` for AI expansion and final fill operations:

```ts
export interface OperationSourceSummary {
  platform: ProductPlatform;
  canonicalUrl: string;
  fields: {
    title: boolean;
    description: boolean;
    price: boolean;
    originalPrice: boolean;
    imageCount: number;
  };
}

export interface OperationLogDetails {
  draft?: OperationDraftSnapshot;
  source?: OperationSourceSummary;
  warnings?: string[];
  result?: string;
  error?: string;
}
```

For `PARSE_PRODUCT` success, `createSuccessLogEntry` must omit `displayTitle` and `details.draft`, and write:

```ts
details: {
  source: {
    platform: product.platform,
    canonicalUrl: product.canonicalUrl,
    fields: {
      title: product.title.trim().length > 0,
      description: product.description.trim().length > 0,
      price: product.price !== null,
      originalPrice: product.originalPrice !== undefined,
      imageCount: product.images.length
    }
  },
  ...(product.warnings.length === 0 ? {} : { warnings: product.warnings }),
  result: '商品解析完成'
}
```

Sanitize and validate `source.canonicalUrl`, cap `imageCount` at 9, and render the source summary in `OperationLog` without reconstructing field values. AI/fill logs keep their existing user-edited draft snapshots because they are not raw source-page extraction logs.

- [ ] **Step 6: Run quality-gate tests and typecheck**

Run:

```bash
pnpm vitest run tests/unit/parsers.test.ts tests/unit/messages.test.ts tests/unit/operation-log.test.ts tests/unit/operation-log-factory.test.ts tests/unit/operation-log-component.test.tsx tests/unit/sidepanel-state.test.ts tests/unit/sidepanel-app.test.tsx
pnpm typecheck
```

Expected: PASS; no title-only response reaches `PARSE_SUCCEEDED`.

- [ ] **Step 7: Commit the quality gate**

```bash
git add src/domain/product.ts src/domain/messages.ts src/parsers/common.ts src/storage/operation-log.ts src/background/operation-log-factory.ts src/sidepanel/state.ts src/sidepanel/components/ProductEditor.tsx src/sidepanel/components/OperationLog.tsx tests/unit/parsers.test.ts tests/unit/messages.test.ts tests/unit/operation-log.test.ts tests/unit/operation-log-factory.test.ts tests/unit/operation-log-component.test.tsx tests/unit/sidepanel-state.test.ts tests/unit/sidepanel-app.test.tsx
git commit -m "fix(parser): 拒绝证据不足的商品解析结果"
```

---

### Task 6: 短链解析后的同商品标签页复用与语义就绪

**Files:**
- Create: `src/background/product-tab-orchestrator.ts`
- Create: `src/background/product-readiness.ts`
- Modify: `src/background/tabs.ts:1-60,81-108`
- Modify: `src/background/tab-settle.ts:28-139`
- Modify: `src/background/handlers.ts:124-294`
- Modify: `entrypoints/product-extractor.ts`
- Create: `tests/unit/product-tab-orchestrator.test.ts`
- Create: `tests/unit/product-readiness.test.ts`
- Modify: `tests/unit/tabs.test.ts:17-28`
- Modify: `tests/unit/tab-settle.test.ts:56-158`
- Modify: `tests/unit/background-tabs.test.ts`

**Interfaces:**
- Consumes: `ProductIdentity`, `sameProductIdentity`, platform family validation and extraction message protocol.
- Produces: `selectProductSourceTab`, `waitForProductPageReady` and `withResolvedProductTab`.

- [ ] **Step 1: Write failing identity-reuse and readiness tests**

Identity matching must ignore tracking/hash but preserve variant conflicts:

```ts
expect(
  selectProductSourceTab(
    [{ id: 7, url: 'https://item.m.jd.com/product/100.html?utm_source=share#detail', active: false, windowId: 1 }],
    parseProductIdentity('https://item.jd.com/100.html')!
  )
).toEqual({ kind: 'reuse', tabId: 7 });
```

Add an orchestrator test where:

1. submitted URL is `https://3.cn/short`;
2. temporary tab settles at `https://item.m.jd.com/product/100.html?utm_source=share`;
3. a second tab already has `https://item.jd.com/100.html`;
4. the operation runs on the existing tab;
5. only the temporary tab is closed.

Add readiness probe tests for:

- `complete` and stable URL but no product marker → keep polling.
- product route plus JSON-LD Product, platform main container or embedded item state → ready.
- login/captcha/error page → terminal failure immediately.
- timeout → `商品页面尚未准备完成，请稍后重试`.

- [ ] **Step 2: Run the focused tab tests and verify failures**

Run:

```bash
pnpm vitest run tests/unit/tabs.test.ts tests/unit/tab-settle.test.ts tests/unit/product-tab-orchestrator.test.ts tests/unit/product-readiness.test.ts tests/unit/background-tabs.test.ts
```

Expected: FAIL because source-tab selection still compares exact URLs and there is no semantic readiness probe.

- [ ] **Step 3: Replace exact URL selection with product identity selection**

Export:

```ts
export type ProductSourceTabSelection = { kind: 'reuse'; tabId: number } | { kind: 'create' };

export function selectProductSourceTab(
  tabs: readonly BrowserTab[],
  identity: ProductIdentity,
  excludedTabId?: number
): ProductSourceTabSelection;
```

Parse each tab URL through `parseProductIdentity` and compare with `sameProductIdentity`. Do not reuse login, verification, non-product or cross-platform tabs.

- [ ] **Step 4: Add a safe semantic readiness message**

The extractor accepts a second internal message:

```ts
type ProductExtractorMessage =
  | { type: 'EXTRACT_PRODUCT_DOCUMENT'; hintedTitle?: string }
  | { type: 'CHECK_PRODUCT_PAGE_READINESS' };

type ProductPageReadiness =
  | { state: 'ready' }
  | { state: 'waiting' }
  | { state: 'failed'; message: string; code: string };
```

The page-side readiness check uses the same error detector and known product-route parser as extraction. It reports ready only when at least one of these exists:

- JSON-LD `Product`;
- a platform main product/title/price/gallery marker already used by the matching adapter;
- strict embedded state assignment for the current platform.

The response contains only state, safe message and code; never DOM or script content.

- [ ] **Step 5: Implement bounded readiness polling**

Create:

```ts
export interface ProductReadinessDependencies {
  probe(tabId: number): Promise<ProductPageReadiness>;
}

export async function waitForProductPageReady(
  dependencies: ProductReadinessDependencies,
  tabId: number,
  options?: { intervalMs?: number; timeoutMs?: number }
): Promise<void>;
```

Use defaults `intervalMs: 250` and `timeoutMs: 10_000`. Stop immediately on `failed`; on timeout throw only the safe timeout message. Tests use fake timers—production code must not sleep synchronously.

- [ ] **Step 6: Implement resolved-tab orchestration**

`withResolvedProductTab` must follow this order:

- Full URL with identity: reuse an existing matching tab; otherwise create a temporary tab.
- Short URL/no identity: create a temporary tab and wait for safe URL settlement.
- Parse final identity; if missing, fail as non-product route.
- Query tabs again; if another matching tab exists, switch the operation target to it.
- On the chosen target: wait for URL completion/stability, inject extractor once, wait for semantic readiness, then extract.
- Close only a tab created by the extension, including when switching from the temporary short-link tab to an existing tab or when any step fails.

`waitForTabSettled` retains its quiet URL window for redirect safety, but semantic readiness becomes mandatory before extraction; `complete + 800ms` is no longer sufficient by itself.

- [ ] **Step 7: Wire handlers to the orchestrator**

Replace the `withSourceTab` block in `parseProduct` with `withResolvedProductTab`. Preserve `message.submittedUrl`; set `canonicalUrl` from the final `ProductIdentity`, not the share URL. Keep the same 30-second navigation timeout and never activate temporary tabs.

- [ ] **Step 8: Run tab, parser and handler tests**

Run:

```bash
pnpm vitest run tests/unit/tabs.test.ts tests/unit/tab-settle.test.ts tests/unit/product-tab-orchestrator.test.ts tests/unit/product-readiness.test.ts tests/unit/background-tabs.test.ts tests/unit/parsers.test.ts
pnpm typecheck
```

Expected: PASS; short links reuse the resolved existing product tab and terminal page errors do not consume the readiness timeout.

- [ ] **Step 9: Commit the tab orchestration**

```bash
git add src/background/product-tab-orchestrator.ts src/background/product-readiness.ts src/background/tabs.ts src/background/tab-settle.ts src/background/handlers.ts entrypoints/product-extractor.ts tests/unit/product-tab-orchestrator.test.ts tests/unit/product-readiness.test.ts tests/unit/tabs.test.ts tests/unit/tab-settle.test.ts tests/unit/background-tabs.test.ts
git commit -m "fix(background): 按商品身份复用并等待来源页面"
```

---

### Task 7: 天猫文案、平台来源 UI 和用户验证文档

**Files:**
- Modify: `src/sidepanel/App.tsx:736-755`
- Modify: `src/sidepanel/state.ts:69-78,415-425`
- Modify: `src/sidepanel/components/ProductEditor.tsx:23-27`
- Modify: `wxt.config.ts:11-21`
- Modify: `package.json:1-10`
- Modify: `README.md`
- Modify: `docs/本地安装与验证.md`
- Modify: `tests/unit/sidepanel-app.test.tsx`
- Modify: `tests/unit/sidepanel-state.test.ts`
- Modify: `tests/unit/build-artifacts.test.ts`

**Interfaces:**
- Consumes: independent `tmall` draft platform from Task 1.
- Produces: consistent user-visible support copy and independent source labels.

- [ ] **Step 1: Write failing copy and source-label tests**

Assert these exact strings:

```ts
expect(screen.getByText('淘宝、天猫与京东')).toBeInTheDocument();
expect(screen.getByPlaceholderText('粘贴淘宝、天猫或京东商品链接')).toBeInTheDocument();
expect(initialWorkflowState.statusMessage).toBe('粘贴淘宝、天猫或京东商品链接开始整理');
```

Render `ProductEditor` with `platform: 'tmall'` and a non-empty canonical URL; expect `天猫来源`. Build-artifact tests must assert the generated manifest description contains `淘宝、天猫和京东`.

- [ ] **Step 2: Run UI tests and verify failures**

Run:

```bash
pnpm vitest run tests/unit/sidepanel-app.test.tsx tests/unit/sidepanel-state.test.ts tests/unit/build-artifacts.test.ts
```

Expected: FAIL on the existing `淘宝与京东` copy and missing Tmall label branch.

- [ ] **Step 3: Update UI and metadata copy**

Use exactly:

- eyebrow: `淘宝、天猫与京东`
- placeholder: `粘贴淘宝、天猫或京东商品链接`
- initial/reset status: `粘贴淘宝、天猫或京东商品链接开始整理`
- source label: `tmall: '天猫来源'`
- manifest description: `解析淘宝、天猫和京东商品，生成可编辑文案并填入闲鱼发布页。`
- package description: `将淘宝、天猫和京东商品整理为闲鱼发布草稿的 Chrome 侧边栏扩展`

- [ ] **Step 4: Update documentation with verified boundaries**

Adjust README and `docs/本地安装与验证.md` so that:

- all support-platform lists include Taobao, Tmall and JD;
- share-copy lists mention both Taobao/Tmall `e.tb.cn` and JD `3.cn`;
- parser architecture describes generic evidence plus three platform adapters;
- real-site disclaimer names all three source platforms;
- manual verification checks title, sale price condition, explicit original price, description, ordered images, warning state and absence of source video;
- documentation does not claim real Taobao/Tmall samples passed until they have actually been checked.

- [ ] **Step 5: Run UI tests and build**

Run:

```bash
pnpm vitest run tests/unit/sidepanel-app.test.tsx tests/unit/sidepanel-state.test.ts tests/unit/build-artifacts.test.ts
pnpm build
```

Expected: PASS; built manifest and side panel contain the three-platform wording.

- [ ] **Step 6: Commit UI and documentation changes**

```bash
git add src/sidepanel/App.tsx src/sidepanel/state.ts src/sidepanel/components/ProductEditor.tsx wxt.config.ts package.json README.md docs/本地安装与验证.md tests/unit/sidepanel-app.test.tsx tests/unit/sidepanel-state.test.ts tests/unit/build-artifacts.test.ts
git commit -m "feat(sidepanel): 补充天猫平台入口和来源标识"
```

---

### Task 8: 完整自动化回归与真实页面验收

**Files:**
- Verify only; if a failure requires a source change, return to the task that owns that file and add a focused regression test before editing.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: reproducible automated evidence and clearly separated real-page verification notes in the final handoff.

- [ ] **Step 1: Run formatting, lint, type and unit tests**

Run:

```bash
git diff --check
pnpm lint
pnpm typecheck
pnpm test
```

Expected: every command exits 0. Record the actual Vitest file/test counts from output; do not copy historical counts.

- [ ] **Step 2: Run production and E2E builds**

Run:

```bash
pnpm build
pnpm test:e2e
```

Expected: production archive/build artifacts are generated and Playwright passes without clicking the final publish button. If the environment blocks E2E, report the exact environment blocker and do not describe E2E as passed.

- [ ] **Step 3: Verify the observed logged-in JD mobile product**

Reload the unpacked extension, keep the existing JD product tab open, paste its complete link and verify against the page:

- title matches the current product;
- displayed `到手价` decodes to `1881.00` for the observed sample;
- explicit original price is `2090.00` and greater than sale;
- description comes from reliable page metadata/state;
- ordered product images exclude the video cover and recommendations;
- the draft warning states that the price is conditional;
- no source video appears in the draft.

Do not save the real product URL, tracking parameters, page script, font file or account data in repository files or logs.

- [ ] **Step 4: Verify Taobao and Tmall only when real samples are available**

For each platform, test one ordinary and one promotion/multi-variant item with a complete link and an `e.tb.cn` share link. Record in the final response which sample categories were actually checked and which were unavailable. Never convert fixture-only coverage into a “real platform verified” claim.

- [ ] **Step 5: Inspect the final diff and commit history**

Run:

```bash
git status --short
git diff HEAD~7 --check
git log --oneline -8
```

Expected: no unintended user files are staged or changed; every functional commit maps to one task above. If the number of implementation commits differs because a task required a corrective commit, compare from commit `2aae530` instead of assuming `HEAD~7`.

## Execution Notes

- The observed JD page on 2026-09-01 used `window._itemOnly` for `item.skuId`, `skuName` and `image`, and `window._itemInfo` for `stock` and `priceFloor`; both assignments contained parenthesized strict JSON followed by ordinary JavaScript.
- The observed main price text was private Unicode plus `到手价`; its OTF `cmap` mapped those characters to the standard glyph names `one`, `eight` and `zero`. This is why runtime font parsing is evidence-based and why a static Unicode-to-digit table is forbidden.
- `opentype.js` is bundled locally. Its official documentation states that it parses browser `ArrayBuffer` values and supports OTF/CFF fonts: <https://github.com/opentypejs/opentype.js/>.
