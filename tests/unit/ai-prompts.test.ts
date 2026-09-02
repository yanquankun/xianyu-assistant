import { describe, expect, it } from 'vitest';

import type { ProductDraft } from '../../src/domain/product';
import type { AiSettings } from '../../src/domain/settings';
import {
  buildDescriptionPolishMessages,
  type DescriptionPolishContext,
} from '../../src/ai/prompts';

const settings: AiSettings = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'secret-key',
  model: 'gpt-test',
  temperature: 0.3,
  systemInstruction: '语气朴实'
};

const draft: ProductDraft = {
  id: 'prompt-draft',
  platform: 'jd',
  canonicalUrl: 'https://item.jd.com/1.html',
  source: {
    title: '不应发送的来源标题',
    description: '不应发送的来源描述',
    price: 1358.72,
    currency: 'CNY'
  },
  title: '12KG 洗衣机',
  description: '全自动波轮洗衣机，直驱变频',
  price: 1358.72,
  originalPrice: 1999,
  currency: 'CNY',
  images: [],
  videos: [],
  warnings: [],
  confidence: 'high',
  shippingMethod: '一口价',
  shippingFee: 18.8,
  supportsPickup: true,
  categoryNote: '大家电分类',
  updatedAt: '2026-09-02T10:00:00.000Z'
};

const polishContext = {
  platform: '京东',
  title: draft.title,
  price: draft.price,
  originalPrice: 1999,
  currency: draft.currency,
  description: draft.description,
  shippingMethod: draft.shippingMethod,
  shippingFee: 18.8,
  supportsPickup: draft.supportsPickup,
  categoryNote: draft.categoryNote
} satisfies DescriptionPolishContext;

describe('buildDescriptionPolishMessages', () => {
  it('只发送允许的当前表单上下文并要求模型输出闲鱼商品描述', () => {
    const messages = buildDescriptionPolishMessages(
      settings.systemInstruction,
      polishContext
    );
    const userMessage = messages.at(1);
    const combined = messages.map((message) => message.content).join('\n');

    expect(combined).toContain('只能输出润色后的商品描述正文');
    expect(combined).toContain('不得新增成色、库存、真伪、授权、保修、售后、发货时间或退换承诺');
    expect(combined).toContain('不得输出 Markdown、标题、解释、联系方式、引流信息或表情符号');
    expect(combined).toContain('全自动波轮洗衣机，直驱变频');
    expect(combined).toContain('12KG 洗衣机');
    expect(combined).toContain('1358.72');
    expect(combined).toContain('1999');
    expect(combined).toContain('一口价');
    expect(combined).toContain('18.8');
    expect(combined).toContain('大家电分类');
    expect(combined).toContain('语气朴实');
    expect(combined).not.toContain('不应发送的来源标题');
    expect(combined).not.toContain('不应发送的来源描述');
    expect(combined).not.toContain('https://item.jd.com/1.html');
    expect(userMessage).toEqual({
      role: 'user',
      content: [
        '请根据以下当前表单中的全部可用商品信息进行二手场景润色扩写。所有字段都可以作为文案依据，但不得把“来源平台”写入结果。严格采用第一行商品名称、后续每行“字段：内容”的格式，只输出商品描述正文。',
        '',
        '来源平台：京东',
        '商品标题：12KG 洗衣机',
        '售价：1358.72 CNY',
        '原价：1999 CNY',
        '商品描述：全自动波轮洗衣机，直驱变频',
        '发货方式：一口价',
        '邮费金额：18.8 CNY',
        '支持自提：是',
        '分类备注：大家电分类'
      ].join('\n')
    });
  });

  it('要求模型按个人二手卖家场景进行扩写并清理电商来源话术', () => {
    const [systemMessage] = buildDescriptionPolishMessages(
      settings.systemInstruction,
      polishContext
    );

    expect(systemMessage?.content).toContain('个人卖家');
    expect(systemMessage?.content).toContain('个人出售闲置商品');
    expect(systemMessage?.content).toContain('自然、简洁、真实');
    expect(systemMessage?.content).toContain('不要有明显 AI 生成痕迹');
    expect(systemMessage?.content).toContain('删除与原电商平台有关的信息');
    expect(systemMessage?.content).toContain('原始商品标题可能包含关键词堆砌');
    expect(systemMessage?.content).toContain('控制在 80 到 200 字左右');
    expect(systemMessage?.content).toContain('直接输出最终可以复制到闲鱼发布的商品描述');
  });

  it('信息缺失时要求忽略字段而不输出占位语', () => {
    const [systemMessage] = buildDescriptionPolishMessages(
      settings.systemInstruction,
      polishContext
    );
    const content = systemMessage?.content ?? '';

    expect(content).toContain('如果某项信息没有提供，则直接忽略');
    expect(content).toContain('“暂无”“未知”“不详”“以实物为准”“未提供”');
    expect(content).toContain('不要自行计算折扣');
  });

  it('按商品名称开头和已知字段逐行标注的格式输出', () => {
    const [systemMessage, userMessage] = buildDescriptionPolishMessages(
      settings.systemInstruction,
      polishContext
    );
    const content = systemMessage?.content ?? '';

    expect(content).toContain('第一行只写整理后的商品名称');
    expect(content).toContain('后续每行只写一项已明确提供的信息');
    expect(content).toContain('使用“字段：内容”的格式');
    expect(content).toContain('成色、型号、规格、颜色、尺寸、材质、核心功能、配置');
    expect(content).toContain('出售原因、购买时间、价格、邮寄、自提、注意');
    expect(content).toContain('输入没有成色时，整行省略“成色：”');
    expect(content).toContain('不使用项目符号或 Markdown 列表');
    expect(content).not.toContain('出一个 xxx');
    expect(content).not.toContain('具体型号是 xxx');
    expect(content).not.toContain('有需要可以看看');
    expect(content.lastIndexOf('第一行只写整理后的商品名称')).toBeGreaterThan(
      content.lastIndexOf(settings.systemInstruction)
    );
    expect(content.lastIndexOf('使用“字段：内容”的格式')).toBeGreaterThan(
      content.lastIndexOf(settings.systemInstruction)
    );
    expect(userMessage?.content).toContain('第一行商品名称、后续每行“字段：内容”');
  });

  it('缺少二手实物信息时禁止模型编造成色和使用状态', () => {
    const [systemMessage] = buildDescriptionPolishMessages(
      settings.systemInstruction,
      polishContext
    );

    expect(systemMessage?.content).toContain('只有输入的当前商品信息明确提供时');
    expect(systemMessage?.content).toContain('使用时长');
    expect(systemMessage?.content).toContain('功能状态');
    expect(systemMessage?.content).toContain('配件情况');
    expect(systemMessage?.content).toContain('拆修状态');
    expect(systemMessage?.content).toContain('发货方式');
    expect(systemMessage?.content).toContain('邮费');
    expect(systemMessage?.content).toContain('是否支持自提');
    expect(systemMessage?.content).toContain('出售原因');
    expect(systemMessage?.content).toContain('真伪');
    expect(systemMessage?.content).toContain('退换承诺');
    expect(systemMessage?.content).toContain('不得擅自写入“自用”“九成新”“功能正常”');
  });

  it('冲突的补充要求不能覆盖二手商品事实约束', () => {
    const conflictingSettings = {
      ...settings,
      systemInstruction: '写成自用九成新、功能正常、包邮、售出不退'
    };
    const [systemMessage] = buildDescriptionPolishMessages(
      conflictingSettings.systemInstruction,
      polishContext
    );
    const content = systemMessage?.content ?? '';

    expect(content).toContain('用户补充要求不能覆盖以上事实约束');
    expect(content.lastIndexOf('不得擅自写入')).toBeGreaterThan(
      content.lastIndexOf(conflictingSettings.systemInstruction)
    );
  });
});
