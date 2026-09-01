import { describe, expect, it } from 'vitest';

import type { ProductDraft } from '../../src/domain/product';
import { validateExpansion } from '../../src/ai/validation';

const draft: ProductDraft = {
  id: 'draft-validation',
  platform: 'jd',
  canonicalUrl: 'https://item.jd.com/1.html',
  source: {
    title: '九成新键盘',
    description: '自用键盘，价格 199 元，正常使用痕迹',
    price: 199,
    currency: 'CNY'
  },
  title: '九成新键盘',
  description: '自用键盘，正常使用痕迹',
  price: 199,
  currency: 'CNY',
  images: [],
  videos: [],
  warnings: [],
  confidence: 'high',
  shippingMethod: '包邮',
  categoryNote: '',
  updatedAt: '2026-08-31T10:00:00.000Z'
};

describe('validateExpansion', () => {
  it('接受结构正确且未增加事实的扩写', () => {
    expect(
      validateExpansion(
        {
          title: '九成新自用键盘',
          description: '自用键盘，正常使用痕迹，价格 199 元。',
          warnings: []
        },
        draft
      )
    ).toEqual({
      title: '九成新自用键盘',
      description: '自用键盘，正常使用痕迹，价格 199 元。',
      warnings: [],
      factWarnings: []
    });
  });

  it('新增来源中不存在的金额时给出事实漂移提示', () => {
    const result = validateExpansion(
      {
        title: '九成新自用键盘',
        description: '原价 599 元，现在价格 199 元。',
        warnings: []
      },
      draft
    );

    expect(result.factWarnings).toContain('AI 文案新增了来源中不存在的数字：599');
  });

  it.each(['全新', '正品', '保修', '官方授权', '七天包退'])(
    '新增高风险声明“%s”时给出提示',
    (claim) => {
      const result = validateExpansion(
        {
          title: '键盘',
          description: `这是一把${claim}键盘。`,
          warnings: []
        },
        draft
      );

      expect(result.factWarnings).toContain(`AI 文案新增了来源中不存在的声明：${claim}`);
    }
  );

  it('缺少标题或描述时拒绝响应', () => {
    expect(() =>
      validateExpansion({ title: '', description: '描述', warnings: [] }, draft)
    ).toThrow('AI 响应缺少有效标题');
    expect(() =>
      validateExpansion({ title: '标题', description: '', warnings: [] }, draft)
    ).toThrow('AI 响应缺少有效描述');
  });

  it('拒绝超过编辑器边界的标题和描述', () => {
    expect(() =>
      validateExpansion({ title: '标'.repeat(61), description: '描述', warnings: [] }, draft)
    ).toThrow('AI 标题超过 60 个字符');
    expect(() =>
      validateExpansion({ title: '标题', description: '描'.repeat(5_001), warnings: [] }, draft)
    ).toThrow('AI 描述超过 5000 个字符');
  });
});
