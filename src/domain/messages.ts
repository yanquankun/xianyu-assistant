import type { AiSettings } from './settings';
import type { ProductDraft } from './product';

export type RuntimeMessage =
  | { type: 'PARSE_PRODUCT'; operationId: string; url: string }
  | { type: 'TEST_AI_CONNECTION'; settings: AiSettings }
  | { type: 'EXPAND_DRAFT'; settings: AiSettings; draft: ProductDraft }
  | { type: 'CHECK_XIANYU_LOGIN' }
  | { type: 'FILL_XIANYU_DRAFT'; draft: ProductDraft }
  | { type: 'OPEN_XIANYU_LOGIN' };

export const runtimeMessageTypes: readonly RuntimeMessage['type'][] = [
  'PARSE_PRODUCT',
  'TEST_AI_CONNECTION',
  'EXPAND_DRAFT',
  'CHECK_XIANYU_LOGIN',
  'FILL_XIANYU_DRAFT',
  'OPEN_XIANYU_LOGIN'
];
