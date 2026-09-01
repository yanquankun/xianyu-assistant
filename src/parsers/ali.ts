import { createEvidenceSet, type EvidenceContext, type ProductEvidenceSet } from './evidence';
import { parsePrice } from './generic';

interface AliEvidenceSelectors {
  title: readonly string[];
  priceRegions: readonly string[];
  galleryRegions: readonly string[];
}

const EXCLUDED_MEDIA_SELECTOR = [
  '[data-recommendation]',
  '[data-review]',
  '[data-avatar]',
  '[data-video]',
  '[data-type="video"]',
  '[class*="recommend" i]',
  '[class*="review" i]',
  '[class*="avatar" i]',
  '[class*="video" i]'
].join(',');

function textFrom(document: Document, selectors: readonly string[]): string | undefined {
  for (const selector of selectors) {
    const element = document.querySelector<HTMLElement>(selector);
    const value = (element?.innerText ?? element?.textContent)?.trim();
    if (value !== undefined && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function firstRegion(document: Document, selectors: readonly string[]): HTMLElement | null {
  for (const selector of selectors) {
    const region = document.querySelector<HTMLElement>(selector);
    if (region !== null) {
      return region;
    }
  }
  return null;
}

function salePriceFromRegion(region: HTMLElement): number | undefined {
  const saleElement = region.querySelector<HTMLElement>('[data-sale-price], [itemprop~="price"]');
  if (saleElement !== null) {
    return parsePrice(saleElement.getAttribute('content') ?? saleElement.textContent);
  }
  const copy = region.cloneNode(true);
  if (!(copy instanceof HTMLElement)) {
    return undefined;
  }
  copy
    .querySelectorAll('[data-original-price], s, del, [class*="original" i], [class*="marketPrice" i]')
    .forEach((element) => element.remove());
  return parsePrice(copy.textContent);
}

function originalPriceFromRegion(region: HTMLElement): number | undefined {
  const element = region.querySelector<HTMLElement>(
    '[data-original-price], s, del, [class*="original" i], [class*="marketPrice" i]'
  );
  if (element === null) {
    return undefined;
  }
  const attribute = element.getAttribute('data-original-price')?.trim();
  return parsePrice(attribute === undefined || attribute.length === 0 ? element.textContent : attribute);
}

function conditionalLabel(region: HTMLElement): string | undefined {
  return /到手价|券后价|会员价/u.exec(region.textContent)?.[0];
}

function isExcludedGalleryImage(image: HTMLImageElement, region: Element): boolean {
  let current: Element | null = image;
  while (current !== null) {
    if (current.matches(EXCLUDED_MEDIA_SELECTOR)) {
      return true;
    }
    if (current === region) {
      return false;
    }
    current = current.parentElement;
  }
  return true;
}

function imageUrl(image: HTMLImageElement): string | undefined {
  for (const attribute of ['data-src', 'data-lazy-src', 'data-lazyload-src', 'src'] as const) {
    const value = image.getAttribute(attribute)?.trim();
    if (value !== undefined && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function galleryRegions(document: Document, selectors: readonly string[]): Element[] {
  const seen = new Set<Element>();
  const regions: Element[] = [];
  for (const selector of selectors) {
    for (const region of document.querySelectorAll(selector)) {
      if (!seen.has(region)) {
        seen.add(region);
        regions.push(region);
      }
    }
  }
  return regions;
}

export function collectAliEvidence(
  document: Document,
  context: EvidenceContext,
  selectors: AliEvidenceSelectors
): ProductEvidenceSet {
  const evidence = createEvidenceSet();
  const binding = {
    ...(context.productId === undefined ? {} : { productId: context.productId }),
    ...(context.skuId === undefined ? {} : { skuId: context.skuId })
  };
  const title = textFrom(document, selectors.title);
  if (title !== undefined) {
    evidence.titles.push({
      value: title,
      source: 'semantic-dom',
      confidence: 'high',
      ...binding
    });
  }

  const priceRegion = firstRegion(document, selectors.priceRegions);
  if (priceRegion !== null) {
    const salePrice = salePriceFromRegion(priceRegion);
    const label = conditionalLabel(priceRegion);
    if (salePrice !== undefined) {
      evidence.prices.push({
        value: salePrice,
        currency: 'CNY',
        kind: label === undefined ? 'sale' : 'conditional',
        source: 'semantic-dom',
        confidence: 'high',
        ...(label === undefined ? {} : { label }),
        ...binding
      });
      const originalPrice = originalPriceFromRegion(priceRegion);
      if (originalPrice !== undefined && originalPrice > salePrice) {
        evidence.prices.push({
          value: originalPrice,
          currency: 'CNY',
          kind: 'original',
          source: 'semantic-dom',
          confidence: 'high',
          ...binding
        });
      }
    }
  }

  let position = 0;
  for (const region of galleryRegions(document, selectors.galleryRegions)) {
    for (const image of region.querySelectorAll<HTMLImageElement>('img')) {
      if (isExcludedGalleryImage(image, region)) {
        continue;
      }
      const value = imageUrl(image);
      if (value === undefined) {
        continue;
      }
      evidence.images.push({
        value,
        source: 'platform-gallery',
        confidence: 'high',
        position,
        ...binding
      });
      position += 1;
      if (position === 9) {
        return evidence;
      }
    }
  }
  return evidence;
}
