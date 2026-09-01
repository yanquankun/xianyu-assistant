import type { ExtractionConfidence, ParsedProduct, ProductImage } from '../domain/product';
import type {
  EvidenceContext,
  EvidenceSource,
  FieldEvidence,
  ImageEvidence,
  PriceEvidence,
  ProductEvidenceSet
} from './evidence';
import { resolveUrl } from './generic';

const TITLE_RANK: Record<EvidenceSource, number> = {
  'embedded-state': 500,
  'json-ld': 400,
  'semantic-dom': 300,
  'open-graph': 200,
  meta: 100,
  'platform-gallery': 0
};

const DESCRIPTION_RANK: Record<EvidenceSource, number> = {
  'json-ld': 400,
  'open-graph': 300,
  meta: 200,
  'embedded-state': 100,
  'semantic-dom': 100,
  'platform-gallery': 0
};

const MAX_PRODUCT_IMAGES = 9;

function matchesContext<T>(evidence: FieldEvidence<T>, context: EvidenceContext): boolean {
  return !(
    (evidence.productId !== undefined &&
      context.productId !== undefined &&
      evidence.productId !== context.productId) ||
    (evidence.skuId !== undefined && context.skuId !== undefined && evidence.skuId !== context.skuId)
  );
}

function selectText(
  values: readonly FieldEvidence<string>[],
  context: EvidenceContext,
  ranks: Record<EvidenceSource, number>
): FieldEvidence<string> | undefined {
  return values
    .filter((value) => matchesContext(value, context) && value.value.trim().length > 0)
    .map((value, index) => ({ value, index }))
    .sort(
      (left, right) =>
        ranks[right.value.source] - ranks[left.value.source] || left.index - right.index
    )
    .at(0)?.value;
}

function priceRank(evidence: PriceEvidence, context: EvidenceContext): number {
  const skuRank =
    evidence.skuId !== undefined && evidence.skuId === context.skuId
      ? 10_000
      : 0;
  const kindRank = evidence.kind === 'sale' || evidence.kind === 'conditional' ? 500 : 0;
  return skuRank + kindRank + TITLE_RANK[evidence.source];
}

function selectPrice(
  values: readonly PriceEvidence[],
  context: EvidenceContext,
  kinds: readonly PriceEvidence['kind'][]
): PriceEvidence | undefined {
  return values
    .filter(
      (value) =>
        matchesContext(value, context) &&
        kinds.includes(value.kind) &&
        Number.isFinite(value.value) &&
        value.value >= 0
    )
    .map((value, index) => ({ value, index }))
    .sort(
      (left, right) =>
        priceRank(right.value, context) - priceRank(left.value, context) ||
        left.index - right.index
    )
    .at(0)?.value;
}

function isKnownProductImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === '360buyimg.com' ||
    host.endsWith('.360buyimg.com') ||
    host === 'alicdn.com' ||
    host.endsWith('.alicdn.com') ||
    host === 'tbcdn.cn' ||
    host.endsWith('.tbcdn.cn')
  );
}

function normalizedKnownImagePath(pathname: string): string {
  return pathname
    .replace(/^\/n\d+\/(?:s\d+x\d+_)?(?=jfs\/)/u, '/')
    .replace(/!.*$/u, '')
    .replace(
      /(\.(?:jpe?g|png|webp))_\d+x\d+(?:q\d+)?(?:\.(?:jpe?g|png|webp))?$/iu,
      '$1'
    );
}

function imageIdentity(url: string): string {
  const parsed = new URL(url);
  return isKnownProductImageHost(parsed.hostname)
    ? `${parsed.origin.toLowerCase()}${normalizedKnownImagePath(parsed.pathname)}`
    : parsed.href;
}

interface MergedImages {
  images: ProductImage[];
  selectedEvidence: ImageEvidence[];
}

function mergeImages(evidence: ProductEvidenceSet, context: EvidenceContext): MergedImages {
  const candidates = evidence.images
    .filter((image) => matchesContext(image, context))
    .map((image, index) => ({ image, index }))
    .sort((left, right) => left.image.position - right.image.position || left.index - right.index);
  const seen = new Set<string>();
  const images: ProductImage[] = [];
  const selectedEvidence: ImageEvidence[] = [];

  for (const { image } of candidates) {
    const highResolution =
      image.highResolutionUrl === undefined
        ? null
        : resolveUrl(image.highResolutionUrl, context.pageUrl);
    const url = highResolution ?? resolveUrl(image.value, context.pageUrl);
    if (url === null) {
      continue;
    }
    const identity = imageIdentity(url);
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    images.push({
      id: `image-${String(images.length + 1)}`,
      location: { kind: 'remote', url, extractedBy: image.source },
      loadStatus: 'idle'
    });
    selectedEvidence.push(image);
    if (images.length === MAX_PRODUCT_IMAGES) {
      break;
    }
  }
  return { images, selectedEvidence };
}

function mergeConfidence(
  title: FieldEvidence<string> | undefined,
  price: PriceEvidence | undefined,
  images: readonly ImageEvidence[]
): ExtractionConfidence {
  if (
    title?.confidence === 'high' &&
    price?.confidence === 'high' &&
    images.some((image) => image.confidence === 'high')
  ) {
    return 'high';
  }
  return title !== undefined && (price !== undefined || images.length > 0) ? 'medium' : 'low';
}

function selectCanonicalUrl(evidence: ProductEvidenceSet, context: EvidenceContext): string {
  const selected = evidence.canonicalUrls
    .filter((value) => matchesContext(value, context))
    .map((value, index) => ({ value, index }))
    .sort(
      (left, right) =>
        TITLE_RANK[right.value.source] - TITLE_RANK[left.value.source] ||
        left.index - right.index
    )
    .map(({ value }) => resolveUrl(value.value, context.pageUrl))
    .find((value) => value !== null);
  return selected ?? resolveUrl(context.pageUrl, context.pageUrl) ?? context.pageUrl;
}

export function mergeProductEvidence(
  evidence: ProductEvidenceSet,
  context: EvidenceContext
): ParsedProduct {
  const titleEvidence = selectText(evidence.titles, context, TITLE_RANK);
  const descriptionEvidence = selectText(evidence.descriptions, context, DESCRIPTION_RANK);
  const saleEvidence = selectPrice(evidence.prices, context, ['sale', 'conditional', 'unknown']);
  const originalEvidence = selectPrice(evidence.prices, context, ['original']);
  const price = saleEvidence?.value ?? null;
  const validOriginal =
    originalEvidence !== undefined && price !== null && originalEvidence.value > price
      ? originalEvidence.value
      : undefined;
  const mergedImages = mergeImages(evidence, context);
  const warnings = [...evidence.warnings];

  if (saleEvidence?.kind === 'conditional') {
    warnings.push(
      saleEvidence.label === undefined
        ? '当前售价包含适用条件，请发布前核对'
        : `当前售价为${saleEvidence.label}，请发布前核对适用条件`
    );
  }
  if (originalEvidence !== undefined && price !== null && originalEvidence.value <= price) {
    warnings.push('原价不高于售价，已忽略，请发布前核对');
  }
  if (titleEvidence === undefined) {
    warnings.push('未能识别商品标题，请手动填写');
  }
  if (price === null) {
    warnings.push('未能识别商品价格，请手动填写');
  }
  if (mergedImages.images.length === 0) {
    warnings.push('未能识别商品图片，请手动补充');
  }

  return {
    platform: context.platform,
    canonicalUrl: selectCanonicalUrl(evidence, context),
    title: titleEvidence?.value.trim() ?? '',
    description: descriptionEvidence?.value.trim() ?? '',
    price,
    ...(validOriginal === undefined ? {} : { originalPrice: validOriginal }),
    currency: saleEvidence?.currency ?? 'CNY',
    images: mergedImages.images,
    warnings: [...new Set(warnings)],
    confidence: mergeConfidence(titleEvidence, saleEvidence, mergedImages.selectedEvidence)
  };
}
