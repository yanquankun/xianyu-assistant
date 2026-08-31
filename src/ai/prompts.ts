import type { ProductDraft } from '../domain/product';
import type { AiSettings } from '../domain/settings';

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

const FACT_CONSTRAINT = [
  '你是闲鱼商品文案整理助手。',
  '只能使用输入中已经存在的事实，不得新增成色、库存、真伪、授权、保修、售后、发货时间或退换承诺。',
  '输出必须是 JSON 对象，只能包含 title、description、warnings。',
  'title 和 description 必须是字符串，warnings 必须是字符串数组。'
].join('\n');

export function buildExpansionMessages(
  settings: AiSettings,
  draft: ProductDraft
): ChatMessage[] {
  const system = settings.systemInstruction.trim();
  const facts = {
    platform: draft.platform,
    sourceUrl: draft.canonicalUrl,
    source: draft.source,
    currentDraft: {
      title: draft.title,
      description: draft.description,
      price: draft.price,
      originalPrice: draft.originalPrice,
      currency: draft.currency,
      shippingMethod: draft.shippingMethod,
      categoryNote: draft.categoryNote
    }
  };

  return [
    {
      role: 'system',
      content: system.length === 0 ? FACT_CONSTRAINT : `${FACT_CONSTRAINT}\n用户补充要求：${system}`
    },
    {
      role: 'user',
      content: `请在不改变事实的前提下优化标题和描述。输入：${JSON.stringify(facts)}`
    }
  ];
}

export function buildConnectionMessages(): ChatMessage[] {
  return [
    { role: 'system', content: '你是连接测试助手。' },
    { role: 'user', content: '请简短回复连接成功。' }
  ];
}
