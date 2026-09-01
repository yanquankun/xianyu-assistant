import type { RuntimeMessage } from '../domain/messages';
import { parseParsedProduct } from '../domain/messages';
import type { ProductDraft } from '../domain/product';
import { parseXianyuFillResult, type FillResult } from '../xianyu/fill';
import { parseXianyuLoginCheckResult } from '../xianyu/login';
import {
  sanitizeLogEntry,
  type OperationDraftSnapshot,
  type OperationLogDetails,
  type OperationLogEntry,
  type OperationStage
} from '../storage/operation-log';

const OPERATION_LABELS: Record<RuntimeMessage['type'], string> = {
  PARSE_PRODUCT: '商品解析',
  TEST_AI_CONNECTION: 'AI 连接测试',
  EXPAND_DRAFT: 'AI 扩写',
  CHECK_XIANYU_LOGIN: '登录状态检查',
  FILL_XIANYU_DRAFT: '填入闲鱼',
  OPEN_XIANYU_LOGIN: '打开闲鱼登录页'
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function stageFor(message: RuntimeMessage): OperationStage {
  if (message.type === 'PARSE_PRODUCT') return 'parse';
  if (message.type === 'TEST_AI_CONNECTION' || message.type === 'EXPAND_DRAFT') return 'ai';
  if (message.type === 'CHECK_XIANYU_LOGIN' || message.type === 'OPEN_XIANYU_LOGIN') return 'login';
  return 'fill';
}

function snapshotFromDraft(
  draft: ProductDraft,
  overrides: Partial<Pick<OperationDraftSnapshot, 'title' | 'description'>> = {}
): OperationDraftSnapshot {
  return {
    sourceUrl: draft.submittedUrl ?? draft.canonicalUrl,
    canonicalUrl: draft.canonicalUrl,
    title: overrides.title ?? draft.title,
    description: overrides.description ?? draft.description,
    ...(draft.price === null ? {} : { price: draft.price }),
    ...(draft.originalPrice === undefined ? {} : { originalPrice: draft.originalPrice }),
    shippingMethod: draft.shippingMethod,
    categoryNote: draft.categoryNote,
    selectedImageCount: draft.images.length,
    ...(draft.videos.length === 0
      ? {}
      : { videoName: draft.videos.map((video) => video.fileName).join('、') })
  };
}

function draftFromMessage(message: RuntimeMessage): ProductDraft | undefined {
  return message.type === 'EXPAND_DRAFT' || message.type === 'FILL_XIANYU_DRAFT'
    ? message.draft
    : undefined;
}

function parseExpansion(
  value: unknown
): { title: string; description: string; warnings: string[]; factWarnings: string[] } | undefined {
  if (
    !isRecord(value) ||
    typeof value.title !== 'string' ||
    typeof value.description !== 'string' ||
    !isStringArray(value.warnings) ||
    !isStringArray(value.factWarnings)
  ) {
    return undefined;
  }
  return {
    title: value.title,
    description: value.description,
    warnings: value.warnings,
    factWarnings: value.factWarnings
  };
}

function parseConnectionModel(value: unknown): string | undefined {
  return isRecord(value) && value.connected === true && typeof value.model === 'string'
    ? value.model
    : undefined;
}

function fillDetails(value: unknown): OperationLogDetails {
  const parsed = parseXianyuFillResult({ ok: true, value });
  if (parsed?.ok !== true) {
    return { result: '闲鱼表单填写完成' };
  }
  const result: FillResult = parsed.value;
  const filled = result.filled.length === 0 ? '未填入字段' : `已填入：${result.filled.join('、')}`;
  const skipped = result.skipped.map((entry) => `${entry.field}：${entry.reason}`);
  return {
    result: skipped.length === 0 ? filled : `${filled}；部分跳过，请核对详情`,
    ...(result.warnings.length + skipped.length === 0
      ? {}
      : { warnings: [...result.warnings, ...skipped] })
  };
}

function buildSuccessDetails(
  message: RuntimeMessage,
  value: unknown
): {
  displayTitle?: string;
  details?: OperationLogDetails;
  message: string;
} {
  switch (message.type) {
    case 'PARSE_PRODUCT': {
      const product = parseParsedProduct(value);
      if (product === null) {
        return { message: '商品解析完成' };
      }
      return {
        message: '商品解析完成',
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
      };
    }
    case 'TEST_AI_CONNECTION': {
      const model = parseConnectionModel(value);
      return {
        message: model === undefined ? 'AI 连接测试完成' : `模型 ${model} 连接成功`,
        details: { result: model === undefined ? 'AI 连接测试完成' : `已连接模型：${model}` }
      };
    }
    case 'EXPAND_DRAFT': {
      const expansion = parseExpansion(value);
      if (expansion === undefined) {
        return {
          displayTitle: message.draft.title,
          message: 'AI 扩写完成',
          details: { draft: snapshotFromDraft(message.draft), result: 'AI 扩写完成' }
        };
      }
      const warnings = [...new Set([...expansion.warnings, ...expansion.factWarnings])];
      return {
        displayTitle: expansion.title,
        message: 'AI 文案已写入表单',
        details: {
          draft: snapshotFromDraft(message.draft, {
            title: expansion.title,
            description: expansion.description
          }),
          ...(warnings.length === 0 ? {} : { warnings }),
          result: 'AI 文案已写入表单'
        }
      };
    }
    case 'CHECK_XIANYU_LOGIN': {
      const login = parseXianyuLoginCheckResult(value);
      return {
        message: login?.message ?? '登录状态检查完成',
        details: { result: login?.message ?? '登录状态检查完成' }
      };
    }
    case 'FILL_XIANYU_DRAFT':
      return {
        displayTitle: message.draft.title,
        message: '已填入闲鱼页面',
        details: { draft: snapshotFromDraft(message.draft), ...fillDetails(value) }
      };
    case 'OPEN_XIANYU_LOGIN':
      return { message: '已打开闲鱼登录页', details: { result: '已打开闲鱼登录页' } };
  }
}

export function createSuccessLogEntry(
  message: RuntimeMessage,
  value: unknown,
  id: string,
  timestamp: string
): OperationLogEntry {
  const success = buildSuccessDetails(message, value);
  return sanitizeLogEntry({
    id,
    timestamp,
    stage: stageFor(message),
    outcome: 'success',
    message: success.message,
    operationLabel: OPERATION_LABELS[message.type],
    ...(success.displayTitle === undefined ? {} : { displayTitle: success.displayTitle }),
    ...(success.details === undefined ? {} : { details: success.details })
  });
}

export function createFailureLogEntry(
  message: RuntimeMessage,
  error: string,
  code: string,
  id: string,
  timestamp: string
): OperationLogEntry {
  const draft = draftFromMessage(message);
  return sanitizeLogEntry({
    id,
    timestamp,
    stage: stageFor(message),
    outcome: 'failure',
    message: `${OPERATION_LABELS[message.type]}失败`,
    operationLabel: OPERATION_LABELS[message.type],
    ...(draft === undefined ? {} : { displayTitle: draft.title }),
    code,
    details: {
      ...(draft === undefined ? {} : { draft: snapshotFromDraft(draft) }),
      error
    }
  });
}
