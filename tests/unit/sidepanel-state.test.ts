import { describe, expect, it } from 'vitest';

import type { ParsedProduct, ProductDraft } from '../../src/domain/product';
import {
  createManualDraft,
  draftNeedsResetConfirmation,
  initialWorkflowState,
  reduceWorkflow
} from '../../src/sidepanel/state';

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
  it('仅当草稿没有用户内容或来源时允许直接返回', () => {
    expect(draftNeedsResetConfirmation(createManualDraft('manual-1', '2026-08-31T12:00:00.000Z'))).toBe(false);

    const changedFields: ProductDraft[] = [
      { ...draft, title: '标题' },
      { ...draft, description: '描述' },
      { ...draft, price: 1 },
      { ...draft, originalPrice: 2 },
      { ...draft, shippingMethod: '邮费另议' },
      { ...draft, categoryNote: '分类备注' },
      { ...draft, canonicalUrl: 'https://item.jd.com/2.html' },
      {
        ...draft,
        images: [
          {
            id: 'local-image',
            location: {
              kind: 'local',
              assetId: 'asset-1',
              fileName: 'image.png',
              mimeType: 'image/png',
              byteLength: 1
            },
            selected: true,
            loadStatus: 'loaded'
          }
        ]
      },
      {
        ...draft,
        video: {
          id: 'local-video',
          assetId: 'asset-video',
          fileName: 'video.mp4',
          mimeType: 'video/mp4',
          byteLength: 1
        }
      }
    ];

    for (const changedDraft of changedFields) {
      expect(draftNeedsResetConfirmation(changedDraft)).toBe(true);
    }
  });

  it('重置只清空商品工作流并使迟到异步结果失效', () => {
    const filling = {
      ...initialWorkflowState,
      phase: 'filling' as const,
      activeView: 'logs' as const,
      activeOperationId: 'fill-1',
      sourceUrl: 'https://item.jd.com/1.html',
      draft,
      expansionTarget: { draftId: draft.id, draftUpdatedAt: draft.updatedAt },
      loginState: 'logged-in' as const,
      errorMessage: '旧错误'
    };

    const reset = reduceWorkflow(filling, { type: 'WORKFLOW_RESET' });
    expect(reset).toMatchObject({
      phase: 'idle',
      activeView: 'logs',
      activeOperationId: null,
      sourceUrl: '',
      draft: null,
      expansionTarget: null,
      loginState: 'logged-in',
      errorMessage: null,
      statusMessage: '粘贴淘宝或京东商品链接开始整理'
    });
    expect(reduceWorkflow(reset, {
      type: 'FILL_FINISHED',
      operationId: 'fill-1',
      message: '迟到完成'
    })).toBe(reset);

    expect(
      reduceWorkflow(reset, {
        type: 'PARSE_SUCCEEDED',
        operationId: 'fill-1',
        product: parsedProduct,
        now: '2026-08-31T12:30:00.000Z'
      })
    ).toBe(reset);

    expect(
      reduceWorkflow(reset, {
        type: 'EXPANSION_RECEIVED',
        draftId: draft.id,
        draftUpdatedAt: draft.updatedAt,
        preview: {
          title: '迟到扩写标题',
          description: '迟到扩写描述',
          warnings: [],
          factWarnings: []
        },
        now: '2026-08-31T12:30:00.000Z'
      })
    ).toBe(reset);
  });
  it('可以直接创建手动草稿用于输入和 AI 扩写', () => {
    const draft = createManualDraft('manual-1', '2026-08-31T12:00:00.000Z');
    const state = reduceWorkflow(initialWorkflowState, { type: 'DRAFT_RESTORED', draft });

    expect(state.phase).toBe('editing');
    expect(state.draft).toMatchObject({
      id: 'manual-1',
      platform: 'generic',
      canonicalUrl: '',
      title: '',
      description: '',
      price: null
    });
    expect(state.statusMessage).toBe('已恢复本地草稿');
  });

  it('恢复草稿时重新验证图片加载状态', () => {
    const restored = reduceWorkflow(initialWorkflowState, {
      type: 'DRAFT_RESTORED',
      draft: {
        ...draft,
        images: [
          {
            id: 'stored-image',
            location: {
              kind: 'remote',
              url: 'https://img.example.com/stored.jpg',
              extractedBy: 'dom'
            },
            selected: true,
            loadStatus: 'loaded'
          }
        ]
      }
    });

    expect(restored.draft?.images[0]?.loadStatus).toBe('idle');
  });

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

  it('AI 结果直接写回标题描述并合并去重警告', () => {
    const draftWithWarnings = { ...draft, warnings: ['已有警告', '信息不足'] };
    const started = reduceWorkflow(
      { ...initialWorkflowState, phase: 'editing' as const, draft: draftWithWarnings },
      {
        type: 'EXPANSION_STARTED',
        draftId: draftWithWarnings.id,
        draftUpdatedAt: draftWithWarnings.updatedAt
      }
    );
    const result = reduceWorkflow(started, {
      type: 'EXPANSION_RECEIVED',
      draftId: draftWithWarnings.id,
      draftUpdatedAt: draftWithWarnings.updatedAt,
      preview: {
        title: '扩写标题',
        description: '扩写描述',
        warnings: ['信息不足', '普通警告'],
        factWarnings: ['普通警告', '出现新数字', '已有警告']
      },
      now: '2026-08-31T13:10:00.000Z'
    });

    expect(result.draft).toEqual({
      ...draftWithWarnings,
      title: '扩写标题',
      description: '扩写描述',
      warnings: ['已有警告', '信息不足', '普通警告', '出现新数字'],
      updatedAt: '2026-08-31T13:10:00.000Z'
    });
    expect(result.statusMessage).toBe('AI 文案已写入表单');
  });

  it('草稿已编辑时丢弃迟到的 AI 结果', () => {
    const changed = { ...draft, title: '用户刚修改', updatedAt: 'newer' };
    const expanding = {
      ...initialWorkflowState,
      phase: 'expanding' as const,
      draft: changed,
      expansionTarget: { draftId: draft.id, draftUpdatedAt: draft.updatedAt }
    };

    const result = reduceWorkflow(expanding, {
      type: 'EXPANSION_RECEIVED',
      draftId: draft.id,
      draftUpdatedAt: draft.updatedAt,
      preview: {
        title: '迟到标题',
        description: '迟到描述',
        warnings: [],
        factWarnings: []
      },
      now: '2026-08-31T13:10:00.000Z'
    });

    expect(result).toBe(expanding);
    expect(result.draft?.title).toBe('用户刚修改');
  });

  it('新解析开始后丢弃旧 AI 结果', () => {
    const expanding = reduceWorkflow(
      { ...initialWorkflowState, phase: 'editing' as const, draft },
      {
        type: 'EXPANSION_STARTED',
        draftId: draft.id,
        draftUpdatedAt: draft.updatedAt
      }
    );
    const parsing = reduceWorkflow(expanding, {
      type: 'PARSE_STARTED',
      operationId: 'new-parse',
      url: 'https://item.jd.com/2.html'
    });
    const result = reduceWorkflow(parsing, {
      type: 'EXPANSION_RECEIVED',
      draftId: draft.id,
      draftUpdatedAt: draft.updatedAt,
      preview: {
        title: '不应写回的标题',
        description: '不应写回的描述',
        warnings: [],
        factWarnings: []
      },
      now: '2026-08-31T13:10:00.000Z'
    });

    expect(parsing.expansionTarget).toBeNull();
    expect(result).toBe(parsing);
    expect(result.phase).toBe('parsing');
    expect(result.draft?.title).toBe(draft.title);
  });

  it('AI 扩写失败时保留原草稿并恢复编辑状态', () => {
    const started = reduceWorkflow(
      { ...initialWorkflowState, phase: 'editing' as const, draft },
      {
        type: 'EXPANSION_STARTED',
        draftId: draft.id,
        draftUpdatedAt: draft.updatedAt
      }
    );
    const result = reduceWorkflow(started, {
      type: 'EXPANSION_FAILED',
      draftId: draft.id,
      draftUpdatedAt: draft.updatedAt,
      message: '扩写服务暂不可用'
    });

    expect(result.draft).toEqual(draft);
    expect(result.phase).toBe('editing');
    expect(result.errorMessage).toBe('扩写服务暂不可用');
  });

  it('并发图片加载事件基于最新草稿顺序合并，不互相覆盖', () => {
    const editing = {
      ...initialWorkflowState,
      phase: 'editing' as const,
      draft: {
        ...draft,
        images: [
          {
            id: 'image-1',
            location: {
              kind: 'remote' as const,
              url: 'https://img.example.com/1.jpg',
              extractedBy: 'dom' as const
            },
            selected: true,
            loadStatus: 'idle' as const
          },
          {
            id: 'image-2',
            location: {
              kind: 'remote' as const,
              url: 'https://img.example.com/2.jpg',
              extractedBy: 'dom' as const
            },
            selected: true,
            loadStatus: 'idle' as const
          }
        ]
      }
    };

    const firstLoaded = reduceWorkflow(editing, {
      type: 'IMAGE_LOAD_STATUS_CHANGED',
      id: 'image-1',
      loadStatus: 'loaded'
    });
    const bothLoaded = reduceWorkflow(firstLoaded, {
      type: 'IMAGE_LOAD_STATUS_CHANGED',
      id: 'image-2',
      loadStatus: 'loaded'
    });

    expect(bothLoaded.draft?.images.map((image) => image.loadStatus)).toEqual([
      'loaded',
      'loaded'
    ]);
  });

  it('已选择 9 张图片时第 10 张不能被选中', () => {
    const editing = {
      ...initialWorkflowState,
      phase: 'editing' as const,
      draft: {
        ...draft,
        images: Array.from({ length: 20 }, (_, index) => ({
          id: `image-${String(index + 1)}`,
          location: {
            kind: 'remote' as const,
            url: `https://img.example.com/${String(index + 1)}.jpg`,
            extractedBy: 'dom' as const
          },
          selected: index < 9,
          loadStatus: 'loaded' as const
        }))
      }
    };

    const result = reduceWorkflow(editing, {
      type: 'IMAGE_SELECTION_TOGGLED',
      id: 'image-10'
    });

    expect(result.draft?.images.filter((image) => image.selected)).toHaveLength(9);
    expect(result.draft?.images[9]?.selected).toBe(false);
  });

  it('解析图片与本地图片合计最多选择九张', () => {
    const images = Array.from({ length: 9 }, (_, index) => ({
      id: `image-${String(index)}`,
      location: {
        kind: 'remote' as const,
        url: `https://img.example.com/${String(index)}.jpg`,
        extractedBy: 'dom' as const
      },
      selected: true,
      loadStatus: 'loaded' as const
    }));
    const state = reduceWorkflow(
      { ...initialWorkflowState, phase: 'editing', draft: { ...draft, images } },
      {
        type: 'LOCAL_IMAGES_ADDED',
        images: [
          {
            id: 'local-10',
            location: {
              kind: 'local',
              assetId: 'asset-10',
              fileName: 'ten.png',
              mimeType: 'image/png',
              byteLength: 3
            },
            selected: true,
            loadStatus: 'loaded'
          }
        ],
        now: '2026-08-31T13:00:00.000Z'
      }
    );

    expect(state.draft?.images).toHaveLength(9);
    expect(state.statusMessage).toContain('最多选择 9 张');
  });
});
