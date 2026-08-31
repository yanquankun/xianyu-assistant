import { createAiClient } from '../ai/client';
import { ensureProductDestination, normalizeHttpUrl } from './permissions';
import {
  selectSourceTab,
  selectXianyuLoginTab,
  selectXianyuTab,
  type BrowserTab
} from './tabs';
import type { AppError, AppErrorCode, OperationResult } from '../domain/errors';
import { parseParsedProduct, parseRuntimeMessage, type RuntimeMessage } from '../domain/messages';
import type { ParsedProduct, ProductDraft } from '../domain/product';
import { createLocalStore, type StorageAreaLike } from '../storage/local-store';
import type { OperationStage } from '../storage/operation-log';
import {
  downloadSelectedImages,
  parseXianyuFillResult,
  type FillResult
} from '../xianyu/fill';
import {
  sendXianyuMessage,
  type XianyuContentDependencies
} from '../xianyu/content-ready';
import type { XianyuLoginState } from '../xianyu/login';
import {
  prepareXianyuPublishTab,
  XIANYU_PUBLISH_URL,
  type XianyuTabDependencies
} from '../xianyu/tab-orchestrator';

const XIANYU_LOGIN_URL = 'https://www.goofish.com/login';
const TAB_LOAD_TIMEOUT_MS = 30_000;

function createStorageArea(): StorageAreaLike {
  return {
    get: (keys) => browser.storage.local.get(keys),
    set: (items) => browser.storage.local.set(items),
    setAccessLevel: (options) => browser.storage.local.setAccessLevel(options)
  };
}

const store = createLocalStore(createStorageArea());
const aiClient = createAiClient(fetch);

function toBrowserTab(tab: Browser.tabs.Tab): BrowserTab | null {
  if (tab.id === undefined) {
    return null;
  }
  return {
    id: tab.id,
    ...(tab.url === undefined ? {} : { url: tab.url }),
    active: tab.active,
    windowId: tab.windowId
  };
}

async function listTabs(): Promise<BrowserTab[]> {
  return (await browser.tabs.query({}))
    .map(toBrowserTab)
    .filter((tab): tab is BrowserTab => tab !== null);
}

async function waitForTabComplete(tabId: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      browser.tabs.onUpdated.removeListener(updatedListener);
      browser.tabs.onRemoved.removeListener(removedListener);
    };
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    };
    const timeout = setTimeout(() => {
      finish(new Error('页面加载超时，请检查网络后重试'));
    }, TAB_LOAD_TIMEOUT_MS);
    const updatedListener = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        finish();
      }
    };
    const removedListener = (removedTabId: number) => {
      if (removedTabId === tabId) {
        finish(new Error('页面在加载完成前被关闭'));
      }
    };
    browser.tabs.onUpdated.addListener(updatedListener);
    browser.tabs.onRemoved.addListener(removedListener);
    void browser.tabs.get(tabId).then(
      (tab) => {
        if (tab.status === 'complete') {
          finish();
        }
      },
      () => finish(new Error('无法读取目标标签页'))
    );
  });
}

function xianyuTabDependencies(): XianyuTabDependencies {
  return {
    listTabs,
    async getActiveTabId(): Promise<number | undefined> {
      return (await browser.tabs.query({ active: true, currentWindow: true })).at(0)?.id;
    },
    async update(tabId, options): Promise<BrowserTab> {
      const tab = await browser.tabs.update(tabId, options);
      if (tab === undefined) {
        throw new Error('无法更新闲鱼标签页');
      }
      const mapped = toBrowserTab(tab);
      if (mapped === null) {
        throw new Error('闲鱼标签页缺少有效标识');
      }
      return mapped;
    },
    async create(options): Promise<BrowserTab> {
      const tab = await browser.tabs.create(options);
      const mapped = toBrowserTab(tab);
      if (mapped === null) {
        throw new Error('无法创建闲鱼标签页');
      }
      return mapped;
    },
    waitForComplete: waitForTabComplete
  };
}

function xianyuContentDependencies(): XianyuContentDependencies {
  return {
    waitForComplete: waitForTabComplete,
    async getTabUrl(tabId): Promise<string | undefined> {
      return (await browser.tabs.get(tabId)).url;
    },
    sendMessage: (tabId, message) => browser.tabs.sendMessage(tabId, message),
    async inject(tabId): Promise<void> {
      await browser.scripting.executeScript({
        target: { tabId },
        files: ['/content-scripts/xianyu.js']
      });
    }
  };
}

async function extractProductFromTab(tabId: number): Promise<ParsedProduct> {
  await browser.scripting.executeScript({
    target: { tabId },
    files: ['/product-extractor.js']
  });
  const response: unknown = await browser.tabs.sendMessage(tabId, {
    type: 'EXTRACT_PRODUCT_DOCUMENT'
  });
  const product = parseParsedProduct(response);
  if (product === null) {
    throw new Error('商品解析结果格式无效');
  }
  return product;
}

async function parseProduct(url: string): Promise<ParsedProduct> {
  const normalized = normalizeHttpUrl(url);
  const tabs = await listTabs();
  const selection = selectSourceTab(tabs, normalized.href);
  if (selection.kind === 'reuse') {
    await waitForTabComplete(selection.tabId);
    const tab = await browser.tabs.get(selection.tabId);
    if (tab.url === undefined) {
      throw new Error('无法读取商品页地址');
    }
    ensureProductDestination(normalized, tab.url);
    return extractProductFromTab(selection.tabId);
  }
  const created = await browser.tabs.create({ url: normalized.href, active: false });
  if (created.id === undefined) {
    throw new Error('无法创建商品解析标签页');
  }
  try {
    await waitForTabComplete(created.id);
    const tab = await browser.tabs.get(created.id);
    if (tab.url === undefined) {
      throw new Error('无法读取商品页地址');
    }
    ensureProductDestination(normalized, tab.url);
    return await extractProductFromTab(created.id);
  } finally {
    await browser.tabs.remove(created.id).catch(() => undefined);
  }
}

async function checkXianyuLogin(): Promise<XianyuLoginState> {
  const tabs = await listTabs();
  const activeTabId = (await browser.tabs.query({ active: true, currentWindow: true })).at(0)?.id;
  const selection = selectXianyuTab(tabs, activeTabId);
  if (selection === null) {
    return 'unknown';
  }
  try {
    return await sendXianyuMessage<XianyuLoginState>(
      xianyuContentDependencies(),
      selection.tabId,
      { type: 'CHECK_XIANYU_LOGIN' }
    );
  } catch {
    return 'unknown';
  }
}

function validateDraft(draft: ProductDraft): number {
  if (draft.title.trim().length === 0 || draft.description.trim().length === 0) {
    throw new Error('请先填写标题和描述');
  }
  if (draft.price === null || !Number.isFinite(draft.price) || draft.price <= 0) {
    throw new Error('请填写有效售价');
  }
  if (
    draft.originalPrice !== undefined &&
    (!Number.isFinite(draft.originalPrice) || draft.originalPrice <= 0)
  ) {
    throw new Error('请填写有效原价，或留空');
  }
  const selectedImages = draft.images.filter((image) => image.selected);
  if (selectedImages.length === 0) {
    throw new Error('请至少选择一张商品图片');
  }
  if (selectedImages.some((image) => image.loadStatus !== 'loaded')) {
    throw new Error('请等待已选择图片加载完成，或取消加载失败的图片');
  }
  return draft.price;
}

async function fillDraft(draft: ProductDraft): Promise<FillResult> {
  const price = validateDraft(draft);
  const tabs = await listTabs();
  const activeTabId = (await browser.tabs.query({ active: true, currentWindow: true })).at(0)?.id;
  const existing = selectXianyuTab(tabs, activeTabId);
  if (existing !== null) {
    const existingLoginState = await sendXianyuMessage<XianyuLoginState>(
      xianyuContentDependencies(),
      existing.tabId,
      { type: 'CHECK_XIANYU_LOGIN' }
    );
    if (existingLoginState === 'logged-out') {
      throw new Error('需要登录闲鱼');
    }
    if (existingLoginState !== 'logged-in') {
      throw new Error('无法确认闲鱼登录状态，请在闲鱼页面检查后重试');
    }
  }
  const tab = await prepareXianyuPublishTab(xianyuTabDependencies());
  const loginState = await sendXianyuMessage<XianyuLoginState>(
    xianyuContentDependencies(),
    tab.tabId,
    { type: 'CHECK_XIANYU_LOGIN' }
  );
  if (loginState === 'logged-out') {
    throw new Error('需要登录闲鱼');
  }
  if (loginState !== 'logged-in') {
    throw new Error('无法确认闲鱼登录状态，请在闲鱼页面检查后重试');
  }

  const downloaded = await downloadSelectedImages(fetch, draft.images);
  if (downloaded.files.length === 0) {
    throw new Error(downloaded.failures.at(0)?.message ?? '没有可上传图片');
  }
  const response: unknown = await sendXianyuMessage(
    xianyuContentDependencies(),
    tab.tabId,
    {
      type: 'FILL_XIANYU_FORM',
      payload: {
        title: draft.title,
        description: draft.description,
        price,
        ...(draft.originalPrice === undefined ? {} : { originalPrice: draft.originalPrice }),
        shippingMethod: draft.shippingMethod,
        categoryNote: draft.categoryNote,
        images: downloaded.files
      }
    }
  );
  const fillResult = parseXianyuFillResult(response);
  if (fillResult === null) {
    throw new Error('闲鱼页面返回了无法识别的填写结果');
  }
  if (!fillResult.ok) {
    throw new Error(fillResult.error.message);
  }
  return {
    ...fillResult.value,
    warnings: [
      ...fillResult.value.warnings,
      ...downloaded.failures.map((failure) => `${failure.id}：${failure.message}`)
    ]
  };
}

async function openXianyuLogin(): Promise<void> {
  const tabs = await listTabs();
  const loginTabId = selectXianyuLoginTab(tabs);
  if (loginTabId !== null) {
    await browser.tabs.update(loginTabId, { active: true });
    return;
  }
  await browser.tabs.create({ url: XIANYU_LOGIN_URL, active: true });
}

function appError(code: AppErrorCode, message: string): AppError {
  return {
    code,
    message,
    recovery: '请检查侧边栏提示和当前页面后重试',
    draftPreserved: true
  };
}

function codeFor(message: RuntimeMessage, error: unknown): AppErrorCode {
  if (message.type === 'PARSE_PRODUCT') {
    if (error instanceof Error && error.message.includes('URL')) {
      return 'INVALID_URL';
    }
    return error instanceof Error && error.message.includes('超时')
      ? 'PARSE_TIMEOUT'
      : 'PARSE_FAILED';
  }
  if (message.type === 'TEST_AI_CONNECTION' || message.type === 'EXPAND_DRAFT') {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
    ) {
      return error.code as AppErrorCode;
    }
    return 'AI_NETWORK_ERROR';
  }
  if (message.type === 'FILL_XIANYU_DRAFT') {
    if (error instanceof Error && error.message === '需要登录闲鱼') {
      return 'XIANYU_LOGGED_OUT';
    }
    return error instanceof Error && error.message.includes('无法确认闲鱼登录状态')
      ? 'XIANYU_LOGIN_UNKNOWN'
      : 'XIANYU_FILL_FAILED';
  }
  return 'OPERATION_CANCELLED';
}

function stageFor(message: RuntimeMessage): OperationStage {
  if (message.type === 'PARSE_PRODUCT') return 'parse';
  if (message.type === 'TEST_AI_CONNECTION' || message.type === 'EXPAND_DRAFT') return 'ai';
  if (message.type === 'CHECK_XIANYU_LOGIN' || message.type === 'OPEN_XIANYU_LOGIN') return 'login';
  return 'fill';
}

async function handleRuntimeMessage(message: RuntimeMessage): Promise<OperationResult<unknown>> {
  try {
    let value: unknown;
    switch (message.type) {
      case 'PARSE_PRODUCT':
        value = await parseProduct(message.url);
        break;
      case 'TEST_AI_CONNECTION':
        value = await aiClient.testConnection(message.settings);
        break;
      case 'EXPAND_DRAFT':
        value = await aiClient.expandDraft(message.settings, message.draft);
        break;
      case 'CHECK_XIANYU_LOGIN':
        value = await checkXianyuLogin();
        break;
      case 'FILL_XIANYU_DRAFT':
        value = await fillDraft(message.draft);
        break;
      case 'OPEN_XIANYU_LOGIN':
        await openXianyuLogin();
        value = undefined;
        break;
    }
    await store.appendLog({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      stage: stageFor(message),
      outcome: 'success',
      message: `${message.type} 已完成`
    });
    return { ok: true, value };
  } catch (error) {
    const messageText = error instanceof Error ? error.message : '操作失败';
    const code = codeFor(message, error);
    await store.appendLog({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      stage: stageFor(message),
      outcome: 'failure',
      message: messageText,
      code
    });
    return { ok: false, error: appError(code, messageText) };
  }
}

function isTrustedSidePanelSender(sender: { id?: string; url?: string }): boolean {
  if (sender.id !== browser.runtime.id || sender.url === undefined) {
    return false;
  }
  try {
    const senderUrl = new URL(sender.url);
    const extensionUrl = new URL(browser.runtime.getURL('/'));
    return senderUrl.origin === extensionUrl.origin && senderUrl.pathname === '/sidepanel.html';
  } catch {
    return false;
  }
}

export function registerBackgroundHandlers(): void {
  void store.initialize().catch((error: unknown) => {
    console.error('扩展本地存储初始化失败', error);
  });
  void browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => {
      console.error('扩展侧边栏行为设置失败', error);
    });
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const parsedMessage = parseRuntimeMessage(message);
    if (parsedMessage === null || !isTrustedSidePanelSender(sender)) {
      return undefined;
    }
    void handleRuntimeMessage(parsedMessage).then(sendResponse);
    return true;
  });
}

export { XIANYU_PUBLISH_URL };
