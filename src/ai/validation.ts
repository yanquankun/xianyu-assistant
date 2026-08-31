import type { ProductDraft } from '../domain/product';

export interface ExpansionPreview {
  title: string;
  description: string;
  warnings: string[];
  factWarnings: string[];
}

const HIGH_RISK_CLAIMS = ['全新', '正品', '保修', '官方授权', '七天包退'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRequiredText(record: Record<string, unknown>, key: 'title' | 'description'): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(key === 'title' ? 'AI 响应缺少有效标题' : 'AI 响应缺少有效描述');
  }
  const normalized = value.trim();
  const maximum = key === 'title' ? 60 : 5_000;
  if (normalized.length > maximum) {
    throw new Error(key === 'title' ? 'AI 标题超过 60 个字符' : 'AI 描述超过 5000 个字符');
  }
  return normalized;
}

function readWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function findNumbers(value: string): Set<string> {
  return new Set(value.match(/\d+(?:\.\d+)?/gu) ?? []);
}

function createFactWarnings(title: string, description: string, draft: ProductDraft): string[] {
  const sourceText = [
    draft.source.title,
    draft.source.description,
    String(draft.source.price ?? ''),
    String(draft.source.originalPrice ?? ''),
    draft.title,
    draft.description,
    String(draft.price ?? ''),
    String(draft.originalPrice ?? '')
  ].join('\n');
  const outputText = `${title}\n${description}`;
  const sourceNumbers = findNumbers(sourceText);
  const outputNumbers = findNumbers(outputText);
  const warnings: string[] = [];

  for (const number of outputNumbers) {
    if (!sourceNumbers.has(number)) {
      warnings.push(`AI 文案新增了来源中不存在的数字：${number}`);
    }
  }
  for (const claim of HIGH_RISK_CLAIMS) {
    if (outputText.includes(claim) && !sourceText.includes(claim)) {
      warnings.push(`AI 文案新增了来源中不存在的声明：${claim}`);
    }
  }
  return warnings;
}

export function validateExpansion(input: unknown, draft: ProductDraft): ExpansionPreview {
  if (!isRecord(input)) {
    throw new Error('AI 响应不是 JSON 对象');
  }
  const title = readRequiredText(input, 'title');
  const description = readRequiredText(input, 'description');
  return {
    title,
    description,
    warnings: readWarnings(input.warnings),
    factWarnings: createFactWarnings(title, description, draft)
  };
}
