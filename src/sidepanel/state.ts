import type { ExpansionPreview } from '../ai/validation';
import type { ParsedProduct, ProductDraft, ProductImage, ProductVideo } from '../domain/product';
import { MAX_MEDIA_COUNT } from '../media/validation';
import type { XianyuLoginState } from '../xianyu/login';

export type WorkflowPhase = 'idle' | 'parsing' | 'editing' | 'expanding' | 'filling' | 'error';
export type PanelView = 'product' | 'settings' | 'logs';

export interface WorkflowState {
  phase: WorkflowPhase;
  activeView: PanelView;
  activeOperationId: string | null;
  sourceUrl: string;
  draft: ProductDraft | null;
  expansionTarget: {
    draftId: string;
    draftUpdatedAt: string;
  } | null;
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
  | {
      type: 'IMAGE_LOAD_STATUS_CHANGED';
      id: string;
      loadStatus: ProductDraft['images'][number]['loadStatus'];
    }
  | {
      type: 'LOCAL_IMAGES_ADDED';
      draftId?: string;
      images: readonly ProductImage[];
      now: string;
      notice?: string;
    }
  | { type: 'IMAGE_REMOVED'; id: string; now: string }
  | {
      type: 'VIDEOS_ADDED';
      draftId?: string;
      videos: readonly ProductVideo[];
      now: string;
      notice?: string;
    }
  | { type: 'VIDEO_REMOVED'; id: string; now: string }
  | { type: 'EXPANSION_STARTED'; draftId: string; draftUpdatedAt: string }
  | {
      type: 'EXPANSION_RECEIVED';
      draftId: string;
      draftUpdatedAt: string;
      preview: ExpansionPreview;
      now: string;
    }
  | { type: 'EXPANSION_FAILED'; draftId: string; draftUpdatedAt: string; message: string }
  | { type: 'LOGIN_STATE_CHANGED'; loginState: XianyuLoginState }
  | { type: 'FILL_STARTED'; operationId: string }
  | { type: 'FILL_FINISHED'; operationId: string; message: string }
  | { type: 'FILL_FAILED'; operationId: string; message: string }
  | { type: 'WORKFLOW_RESET' }
  | { type: 'OPERATION_FAILED'; message: string };

export const initialWorkflowState: WorkflowState = {
  phase: 'idle',
  activeView: 'product',
  activeOperationId: null,
  sourceUrl: '',
  draft: null,
  expansionTarget: null,
  loginState: 'unknown',
  statusMessage: '粘贴淘宝或京东商品链接开始整理',
  errorMessage: null
};

function createDraft(product: ParsedProduct, id: string, now: string): ProductDraft {
  return {
    id,
    platform: product.platform,
    ...(product.submittedUrl === undefined ? {} : { submittedUrl: product.submittedUrl }),
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
    videos: [],
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
    videos: [],
    warnings: [],
    confidence: 'low',
    shippingMethod: '包邮',
    categoryNote: '',
    updatedAt: now
  };
}

export function draftNeedsResetConfirmation(draft: ProductDraft): boolean {
  return (
    draft.title.trim().length > 0 ||
    draft.description.trim().length > 0 ||
    draft.price !== null ||
    draft.originalPrice !== undefined ||
    draft.shippingMethod !== '包邮' ||
    draft.categoryNote.trim().length > 0 ||
    draft.canonicalUrl.trim().length > 0 ||
    draft.images.length > 0 ||
    draft.videos.length > 0
  );
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
        expansionTarget: null,
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
        expansionTarget: null,
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
          images: action.draft.images.map((image) => ({
            ...image,
            loadStatus: image.location.kind === 'remote' ? 'idle' : image.loadStatus
          }))
        },
        expansionTarget: null,
        statusMessage: '已恢复本地草稿',
        errorMessage: null
      };
    case 'DRAFT_CHANGED':
      return { ...state, draft: action.draft, expansionTarget: null, phase: 'editing' };
    case 'IMAGE_LOAD_STATUS_CHANGED':
      if (state.draft === null) {
        return state;
      }
      return {
        ...state,
        phase: 'editing',
        expansionTarget: null,
        draft: {
          ...state.draft,
          images: state.draft.images.map((image) =>
            image.id === action.id
              ? {
                  ...image,
                  loadStatus: action.loadStatus
                }
              : image
          ),
          updatedAt: new Date().toISOString()
        }
      };
    case 'LOCAL_IMAGES_ADDED':
      if (
        state.draft === null ||
        (action.draftId !== undefined && state.draft.id !== action.draftId)
      ) {
        return state;
      }
      {
        const remainingSlots = Math.max(
          0,
          MAX_MEDIA_COUNT - state.draft.images.length - state.draft.videos.length
        );
        const accepted = action.images.slice(0, remainingSlots);
        const skipped = action.images.length - accepted.length;
        return {
          ...state,
          phase: 'editing',
          expansionTarget: null,
          draft: {
            ...state.draft,
            images: [...state.draft.images, ...accepted],
            updatedAt: action.now
          },
          statusMessage:
            action.notice ??
            (skipped > 0
              ? `最多添加 ${String(MAX_MEDIA_COUNT)} 个媒体，超出部分未添加`
              : '本地图片已添加'),
          errorMessage: null
        };
      }
    case 'IMAGE_REMOVED':
      if (state.draft === null) {
        return state;
      }
      return {
        ...state,
        phase: 'editing',
        expansionTarget: null,
        draft: {
          ...state.draft,
          images: state.draft.images.filter((image) => image.id !== action.id),
          updatedAt: action.now
        },
        statusMessage: '图片已移除',
        errorMessage: null
      };
    case 'VIDEOS_ADDED':
      if (
        state.draft === null ||
        (action.draftId !== undefined && state.draft.id !== action.draftId)
      ) {
        return state;
      }
      {
        const remainingSlots = Math.max(
          0,
          MAX_MEDIA_COUNT - state.draft.images.length - state.draft.videos.length
        );
        const accepted = action.videos.slice(0, remainingSlots);
        const skipped = action.videos.length - accepted.length;
        return {
          ...state,
          phase: 'editing',
          expansionTarget: null,
          draft: {
            ...state.draft,
            videos: [...state.draft.videos, ...accepted],
            updatedAt: action.now
          },
          statusMessage:
            action.notice ??
            (skipped > 0
              ? `最多添加 ${String(MAX_MEDIA_COUNT)} 个媒体，超出部分未添加`
              : '视频已保存'),
          errorMessage: null
        };
      }
    case 'VIDEO_REMOVED':
      if (!state.draft?.videos.some((video) => video.id === action.id)) {
        return state;
      }
      return {
        ...state,
        phase: 'editing',
        expansionTarget: null,
        draft: {
          ...state.draft,
          videos: state.draft.videos.filter((video) => video.id !== action.id),
          updatedAt: action.now
        },
        statusMessage: '视频已移除',
        errorMessage: null
      };
    case 'EXPANSION_STARTED':
      if (state.draft?.id !== action.draftId || state.draft.updatedAt !== action.draftUpdatedAt) {
        return state;
      }
      return {
        ...state,
        phase: 'expanding',
        expansionTarget: {
          draftId: action.draftId,
          draftUpdatedAt: action.draftUpdatedAt
        },
        statusMessage: 'AI 正在整理文案',
        errorMessage: null
      };
    case 'EXPANSION_RECEIVED': {
      const draft = state.draft;
      const expansionTarget = state.expansionTarget;
      if (
        draft?.id !== action.draftId ||
        draft.updatedAt !== action.draftUpdatedAt ||
        expansionTarget?.draftId !== action.draftId ||
        expansionTarget.draftUpdatedAt !== action.draftUpdatedAt
      ) {
        return state;
      }
      return {
        ...state,
        phase: 'editing',
        expansionTarget: null,
        draft: {
          ...draft,
          title: action.preview.title,
          description: action.preview.description,
          warnings: [
            ...new Set([
              ...draft.warnings,
              ...action.preview.warnings,
              ...action.preview.factWarnings
            ])
          ],
          updatedAt: action.now
        },
        statusMessage: 'AI 文案已写入表单',
        errorMessage: null
      };
    }
    case 'EXPANSION_FAILED': {
      const draft = state.draft;
      const expansionTarget = state.expansionTarget;
      if (
        draft?.id !== action.draftId ||
        draft.updatedAt !== action.draftUpdatedAt ||
        expansionTarget?.draftId !== action.draftId ||
        expansionTarget.draftUpdatedAt !== action.draftUpdatedAt
      ) {
        return state;
      }
      return {
        ...state,
        phase: 'editing',
        expansionTarget: null,
        statusMessage: 'AI 扩写失败',
        errorMessage: action.message
      };
    }
    case 'LOGIN_STATE_CHANGED':
      return { ...state, loginState: action.loginState };
    case 'FILL_STARTED':
      return {
        ...state,
        phase: 'filling',
        activeOperationId: action.operationId,
        statusMessage: '正在填入闲鱼页面',
        errorMessage: null
      };
    case 'FILL_FINISHED':
      if (state.activeOperationId !== action.operationId) {
        return state;
      }
      return {
        ...state,
        phase: 'editing',
        activeOperationId: null,
        statusMessage: action.message,
        errorMessage: null
      };
    case 'FILL_FAILED':
      if (state.activeOperationId !== action.operationId) {
        return state;
      }
      return {
        ...state,
        phase: 'error',
        activeOperationId: null,
        errorMessage: action.message,
        statusMessage: '操作未完成'
      };
    case 'WORKFLOW_RESET':
      return {
        ...state,
        phase: 'idle',
        activeOperationId: null,
        sourceUrl: '',
        draft: null,
        expansionTarget: null,
        statusMessage: '粘贴淘宝或京东商品链接开始整理',
        errorMessage: null
      };
    case 'OPERATION_FAILED':
      return {
        ...state,
        phase: 'error',
        errorMessage: action.message,
        statusMessage: '操作未完成'
      };
  }
}
