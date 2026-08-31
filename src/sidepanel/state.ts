import type { ExpansionPreview } from '../ai/validation';
import type { ParsedProduct, ProductDraft } from '../domain/product';
import type { XianyuLoginState } from '../xianyu/login';

export type WorkflowPhase = 'idle' | 'parsing' | 'editing' | 'expanding' | 'filling' | 'error';
export type PanelView = 'product' | 'settings' | 'logs';

export interface WorkflowState {
  phase: WorkflowPhase;
  activeView: PanelView;
  activeOperationId: string | null;
  sourceUrl: string;
  draft: ProductDraft | null;
  expansionPreview: ExpansionPreview | null;
  loginState: XianyuLoginState;
  statusMessage: string;
  errorMessage: string | null;
}

export type WorkflowAction =
  | { type: 'VIEW_CHANGED'; view: PanelView }
  | { type: 'SOURCE_URL_CHANGED'; url: string }
  | { type: 'PARSE_STARTED'; operationId: string; url: string }
  | { type: 'PARSE_SUCCEEDED'; operationId: string; product: ParsedProduct; now: string }
  | { type: 'PARSE_FAILED'; operationId: string; message: string }
  | { type: 'DRAFT_RESTORED'; draft: ProductDraft }
  | { type: 'DRAFT_CHANGED'; draft: ProductDraft }
  | { type: 'IMAGE_SELECTION_TOGGLED'; id: string }
  | { type: 'IMAGE_LOAD_STATUS_CHANGED'; id: string; loadStatus: ProductDraft['images'][number]['loadStatus'] }
  | { type: 'EXPANSION_STARTED' }
  | { type: 'EXPANSION_RECEIVED'; preview: ExpansionPreview }
  | { type: 'EXPANSION_APPLIED'; now: string }
  | { type: 'EXPANSION_DISCARDED' }
  | { type: 'LOGIN_STATE_CHANGED'; loginState: XianyuLoginState }
  | { type: 'FILL_STARTED' }
  | { type: 'FILL_FINISHED'; message: string }
  | { type: 'OPERATION_FAILED'; message: string };

export const initialWorkflowState: WorkflowState = {
  phase: 'idle',
  activeView: 'product',
  activeOperationId: null,
  sourceUrl: '',
  draft: null,
  expansionPreview: null,
  loginState: 'unknown',
  statusMessage: '粘贴淘宝或京东商品链接开始整理',
  errorMessage: null
};

function createDraft(product: ParsedProduct, id: string, now: string): ProductDraft {
  return {
    id,
    platform: product.platform,
    canonicalUrl: product.canonicalUrl,
    source: {
      title: product.title,
      description: product.description,
      price: product.price,
      ...(product.originalPrice === undefined ? {} : { originalPrice: product.originalPrice }),
      currency: product.currency
    },
    title: product.title,
    description: product.description,
    price: product.price,
    ...(product.originalPrice === undefined ? {} : { originalPrice: product.originalPrice }),
    currency: product.currency,
    images: product.images,
    warnings: product.warnings,
    confidence: product.confidence,
    shippingMethod: '包邮',
    categoryNote: '',
    updatedAt: now
  };
}

export function createManualDraft(id: string, now: string): ProductDraft {
  return {
    id,
    platform: 'generic',
    canonicalUrl: '',
    source: {
      title: '',
      description: '',
      price: null,
      currency: 'CNY'
    },
    title: '',
    description: '',
    price: null,
    currency: 'CNY',
    images: [],
    warnings: [],
    confidence: 'low',
    shippingMethod: '包邮',
    categoryNote: '',
    updatedAt: now
  };
}

export function reduceWorkflow(state: WorkflowState, action: WorkflowAction): WorkflowState {
  switch (action.type) {
    case 'VIEW_CHANGED':
      return { ...state, activeView: action.view };
    case 'SOURCE_URL_CHANGED':
      return { ...state, sourceUrl: action.url };
    case 'PARSE_STARTED':
      return {
        ...state,
        phase: 'parsing',
        activeOperationId: action.operationId,
        sourceUrl: action.url,
        statusMessage: '正在解析商品页面',
        errorMessage: null
      };
    case 'PARSE_SUCCEEDED':
      if (state.activeOperationId !== action.operationId) {
        return state;
      }
      return {
        ...state,
        phase: 'editing',
        draft: createDraft(action.product, action.operationId, action.now),
        expansionPreview: null,
        statusMessage: '商品信息已解析，请检查并编辑',
        errorMessage: null
      };
    case 'PARSE_FAILED':
      if (state.activeOperationId !== action.operationId) {
        return state;
      }
      return {
        ...state,
        phase: 'error',
        statusMessage: '商品解析失败',
        errorMessage: action.message
      };
    case 'DRAFT_RESTORED':
      return {
        ...state,
        phase: 'editing',
        draft: {
          ...action.draft,
          images: action.draft.images.map((image) => ({ ...image, loadStatus: 'idle' }))
        },
        expansionPreview: null,
        statusMessage: '已恢复本地草稿',
        errorMessage: null
      };
    case 'DRAFT_CHANGED':
      return { ...state, draft: action.draft, phase: 'editing' };
    case 'IMAGE_SELECTION_TOGGLED':
      if (state.draft === null) {
        return state;
      }
      return {
        ...state,
        phase: 'editing',
        draft: {
          ...state.draft,
          images: state.draft.images.map((image) =>
            image.id === action.id ? { ...image, selected: !image.selected } : image
          ),
          updatedAt: new Date().toISOString()
        }
      };
    case 'IMAGE_LOAD_STATUS_CHANGED':
      if (state.draft === null) {
        return state;
      }
      return {
        ...state,
        phase: 'editing',
        draft: {
          ...state.draft,
          images: state.draft.images.map((image) =>
            image.id === action.id
              ? {
                  ...image,
                  loadStatus: action.loadStatus,
                  selected: action.loadStatus === 'failed' ? false : image.selected
                }
              : image
          ),
          updatedAt: new Date().toISOString()
        }
      };
    case 'EXPANSION_STARTED':
      return { ...state, phase: 'expanding', statusMessage: 'AI 正在整理文案', errorMessage: null };
    case 'EXPANSION_RECEIVED':
      return {
        ...state,
        phase: 'editing',
        expansionPreview: action.preview,
        statusMessage: 'AI 文案已生成，请先预览'
      };
    case 'EXPANSION_APPLIED':
      if (state.draft === null || state.expansionPreview === null) {
        return state;
      }
      return {
        ...state,
        draft: {
          ...state.draft,
          title: state.expansionPreview.title,
          description: state.expansionPreview.description,
          updatedAt: action.now
        },
        expansionPreview: null,
        statusMessage: '已应用 AI 文案'
      };
    case 'EXPANSION_DISCARDED':
      return { ...state, expansionPreview: null, statusMessage: '已保留原文案' };
    case 'LOGIN_STATE_CHANGED':
      return { ...state, loginState: action.loginState };
    case 'FILL_STARTED':
      return { ...state, phase: 'filling', statusMessage: '正在填入闲鱼页面', errorMessage: null };
    case 'FILL_FINISHED':
      return { ...state, phase: 'editing', statusMessage: action.message, errorMessage: null };
    case 'OPERATION_FAILED':
      return {
        ...state,
        phase: 'error',
        errorMessage: action.message,
        statusMessage: '操作未完成'
      };
  }
}
