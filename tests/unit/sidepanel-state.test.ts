import { describe, expect, it } from 'vitest';

import type { ParsedProduct, ProductDraft } from '../../src/domain/product';
import { initialWorkflowState, reduceWorkflow } from '../../src/sidepanel/state';

const parsedProduct: ParsedProduct = {
  platform: 'jd',
  canonicalUrl: 'https://item.jd.com/1.html',
  title: '解析标题',
  description: '解析描述',
  price: 199,
  currency: 'CNY',
  images: [],
  warnings: [],
  confidence: 'high'
};

const draft: ProductDraft = {
  id: 'operation-1',
  platform: 'jd',
  canonicalUrl: 'https://item.jd.com/1.html',
  source: {
    title: '解析标题',
    description: '解析描述',
    price: 199,
    currency: 'CNY'
  },
  title: '解析标题',
  description: '解析描述',
  price: 199,
  currency: 'CNY',
  images: [],
  warnings: [],
  confidence: 'high',
  shippingMethod: '包邮',
  categoryNote: '',
  updatedAt: '2026-08-31T10:00:00.000Z'
};

describe('reduceWorkflow', () => {
  it('解析成功后进入可编辑状态', () => {
    const parsing = reduceWorkflow(initialWorkflowState, {
      type: 'PARSE_STARTED',
      operationId: 'operation-1',
      url: parsedProduct.canonicalUrl
    });

    const state = reduceWorkflow(parsing, {
      type: 'PARSE_SUCCEEDED',
      operationId: 'operation-1',
      product: parsedProduct,
      now: '2026-08-31T10:00:00.000Z'
    });

    expect(state.phase).toBe('editing');
    expect(state.draft).toEqual(draft);
  });

  it('旧解析结果不能覆盖较新的操作', () => {
    const parsing = {
      ...initialWorkflowState,
      phase: 'parsing' as const,
      activeOperationId: 'operation-new'
    };

    const state = reduceWorkflow(parsing, {
      type: 'PARSE_SUCCEEDED',
      operationId: 'operation-old',
      product: parsedProduct,
      now: '2026-08-31T10:00:00.000Z'
    });

    expect(state).toEqual(parsing);
  });

  it('AI 扩写先保存预览，只有应用动作才修改草稿', () => {
    const editing = { ...initialWorkflowState, phase: 'editing' as const, draft };
    const previewed = reduceWorkflow(editing, {
      type: 'EXPANSION_RECEIVED',
      preview: {
        title: '扩写标题',
        description: '扩写描述',
        warnings: [],
        factWarnings: []
      }
    });

    expect(previewed.draft?.title).toBe('解析标题');
    expect(previewed.expansionPreview?.title).toBe('扩写标题');

    const applied = reduceWorkflow(previewed, {
      type: 'EXPANSION_APPLIED',
      now: '2026-08-31T10:05:00.000Z'
    });
    expect(applied.draft?.title).toBe('扩写标题');
    expect(applied.expansionPreview).toBeNull();
  });
});
