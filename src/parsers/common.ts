import { normalizeHttpUrl } from '../background/permissions';
import type { ParsedProduct } from '../domain/product';
import { parseGeneric } from './generic';
import { parseJdDom } from './jd';
import { mergeProductCandidates } from './merge';
import { parseTaobaoDom } from './taobao';

export function parseProductDocument(document: Document, pageUrl: string): ParsedProduct {
  const normalized = normalizeHttpUrl(pageUrl);
  const generic = parseGeneric(document, normalized.href, normalized.platform);
  const platformCandidate =
    normalized.platform === 'taobao'
      ? parseTaobaoDom(document)
      : normalized.platform === 'jd'
        ? parseJdDom(document)
        : null;
  const candidates =
    platformCandidate === null
      ? generic.candidates
      : [...generic.candidates, platformCandidate];
  return mergeProductCandidates(candidates, normalized.href, generic.warnings);
}
