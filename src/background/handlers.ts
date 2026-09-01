import { createAiClient } from '../ai/client';
import { checkXianyuLoginFromTabs } from './login-check';
import { createFailureLogEntry, createSuccessLogEntry } from './operation-log-factory';
import { normalizeHttpUrl } from './permissions';
import {
  isProductPageReadiness,
  waitForProductPageReady
} from './product-readiness';
import { withResolvedProductTab } from './product-tab-orchestrator';
import {
  waitForTabSettled,
  type SettledBrowserTab,
  type TabRemovedListener,
  type TabSettledDependencies,
  type TabUpdatedListener
} from './tab-settle';
import { selectXianyuLoginTab, selectXianyuTab, type BrowserTab } from './tabs';
import type { AppError, AppErrorCode, OperationResult } from '../domain/errors';
import {
  parseProductExtractionResponse,
  parseRuntimeMessage,
  type RuntimeMessage
} from '../domain/messages';
import type { ParsedProduct, ProductDraft } from '../domain/product';
import { createLocalStore, type StorageAreaLike } from '../storage/local-store';
import { createMediaStore } from '../storage/media-store';
import type { OperationLogEntry } from '../storage/operation-log';
import {
  formatImageDownloadFailureWarning,
  parseXianyuFillResult,
  prepareImages,
  type FillResult
} from '../xianyu/fill';
import {
  MEDIA_TRANSFER_PORT_NAME,
  createMediaTransferRegistry,
  isMediaTransferClientRequest,
  isTrustedMediaTransferSender
} from '../xianyu/media-transfer';
import { sendXianyuMessage, type XianyuContentDependencies } from '../xianyu/content-ready';
import type { XianyuLoginCheckResult, XianyuLoginState } from '../xianyu/login';
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
    remove: (keys) => browser.storage.local.remove(keys),
    setAccessLevel: (options) => browser.storage.local.setAccessLevel(options)
  };
}

const store = createLocalStore(createStorageArea());
const mediaStore = createMediaStore();
const mediaTransferRegistry = createMediaTransferRegistry(mediaStore);
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

function tabSettleDependencies(): TabSettledDependencies {
  const updatedWrappers = new Map<
    TabUpdatedListener,
    Parameters<typeof browser.tabs.onUpdated.addListener>[0]
  >();
  const removedWrappers = new Map<
    TabRemovedListener,
    Parameters<typeof browser.tabs.onRemoved.addListener>[0]
  >();
  return {
    async get(tabId): Promise<SettledBrowserTab> {
      const tab = await browser.tabs.get(tabId);
      return {
        id: tab.id ?? tabId,
        ...(tab.url === undefined ? {} : { url: tab.url }),
        ...(tab.status === undefined ? {} : { status: tab.status })
      };
    },
    onUpdated: {
      addListener(listener): void {
        const wrapper: Parameters<typeof browser.tabs.onUpdated.addListener>[0] = (
          tabId,
          changeInfo,
          tab
        ) => {
          listener(
            tabId,
            {
              ...(changeInfo.status === undefined ? {} : { status: changeInfo.status }),
              ...(changeInfo.url === undefined ? {} : { url: changeInfo.url })
            },
            {
              id: tab.id ?? tabId,
              ...(tab.url === undefined ? {} : { url: tab.url }),
              ...(tab.status === undefined ? {} : { status: tab.status })
            }
          );
        };
        updatedWrappers.set(listener, wrapper);
        browser.tabs.onUpdated.addListener(wrapper);
      },
      removeListener(listener): void {
        const wrapper = updatedWrappers.get(listener);
        if (wrapper !== undefined) {
          browser.tabs.onUpdated.removeListener(wrapper);
          updatedWrappers.delete(listener);
        }
      }
    },
    onRemoved: {
      addListener(listener): void {
        const wrapper: Parameters<typeof browser.tabs.onRemoved.addListener>[0] = (tabId) => {
          listener(tabId);
        };
        removedWrappers.set(listener, wrapper);
        browser.tabs.onRemoved.addListener(wrapper);
      },
      removeListener(listener): void {
        const wrapper = removedWrappers.get(listener);
        if (wrapper !== undefined) {
          browser.tabs.onRemoved.removeListener(wrapper);
          removedWrappers.delete(listener);
        }
      }
    }
  };
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

async function prepareProductExtractor(tabId: number): Promise<void> {
  await browser.scripting.executeScript({
    target: { tabId },
    files: ['/product-extractor.js']
  });
}

async function readProductPageReadiness(tabId: number) {
  const response: unknown = await browser.tabs.sendMessage(tabId, {
    type: 'CHECK_PRODUCT_PAGE_READINESS'
  });
  if (!isProductPageReadiness(response)) {
    throw new Error('商品页面就绪状态格式无效');
  }
  return response;
}

async function extractProductFromTab(tabId: number, hintedTitle?: string): Promise<ParsedProduct> {
  const response: unknown = await browser.tabs.sendMessage(tabId, {
    type: 'EXTRACT_PRODUCT_DOCUMENT',
    ...(hintedTitle === undefined ? {} : { hintedTitle })
  });
  const extraction = parseProductExtractionResponse(response);
  if (extraction === null) {
    throw new Error('商品解析结果格式无效');
  }
  if (!extraction.ok) {
    throw new Error(extraction.error.message);
  }
  return extraction.product;
}

async function parseProduct(
  message: Extract<RuntimeMessage, { type: 'PARSE_PRODUCT' }>
): Promise<ParsedProduct> {
  const normalized = normalizeHttpUrl(message.url);
  return withResolvedProductTab(
    {
      listTabs,
      async create(url, active): Promise<BrowserTab> {
        const tab = await browser.tabs.create({ url, active });
        const mapped = toBrowserTab(tab);
        if (mapped === null) {
          throw new Error('无法创建商品解析标签页');
        }
        return mapped;
      },
      remove: (tabId) => browser.tabs.remove(tabId),
      waitForSettled: (tabId, submittedUrl) =>
        waitForTabSettled(tabSettleDependencies(), tabId, submittedUrl, {
          quietMs: 800,
          timeoutMs: TAB_LOAD_TIMEOUT_MS
        }),
      prepare: prepareProductExtractor,
      waitForReady: (tabId) =>
        waitForProductPageReady(() => readProductPageReadiness(tabId))
    },
    normalized.href,
    async (tabId, identity) => {
      const product = await extractProductFromTab(tabId, message.hintedTitle);
      return {
        ...product,
        submittedUrl: message.submittedUrl,
        canonicalUrl: identity.canonicalUrl
      };
    }
  );
}

async function checkXianyuLogin(): Promise<XianyuLoginCheckResult> {
  return checkXianyuLoginFromTabs({
    listTabs,
    async getActiveTabId(): Promise<number | undefined> {
      return (await browser.tabs.query({ active: true, currentWindow: true })).at(0)?.id;
    },
    readLoginState: (tabId) =>
      sendXianyuMessage<unknown>(xianyuContentDependencies(), tabId, {
        type: 'CHECK_XIANYU_LOGIN'
      })
  });
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
  if (draft.images.some((image) => image.loadStatus !== 'loaded')) {
    throw new Error('请等待图片加载完成，或删除加载失败的图片');
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

  const downloaded = await prepareImages(fetch, mediaStore, draft.images);
  const videoTransfers: Awaited<ReturnType<typeof mediaTransferRegistry.create>>[] = [];
  const videoFailures: string[] = [];
  for (const video of draft.videos) {
    try {
      videoTransfers.push(await mediaTransferRegistry.create(video.assetId, tab.tabId));
    } catch (error) {
      videoFailures.push(
        `${video.fileName}：${error instanceof Error ? error.message : '视频传输准备失败'}`
      );
    }
  }
  try {
    const response: unknown = await sendXianyuMessage(xianyuContentDependencies(), tab.tabId, {
      type: 'FILL_XIANYU_FORM',
      payload: {
        title: draft.title,
        description: draft.description,
        price,
        ...(draft.originalPrice === undefined ? {} : { originalPrice: draft.originalPrice }),
        shippingMethod: draft.shippingMethod,
        categoryNote: draft.categoryNote,
        images: downloaded.files,
        ...(videoTransfers.length === 0 ? {} : { videoTransfers })
      }
    });
    const fillResult = parseXianyuFillResult(response);
    if (fillResult === null) {
      throw new Error('闲鱼页面返回了无法识别的填写结果');
    }
    if (!fillResult.ok) {
      throw new Error(fillResult.error.message);
    }
    const skipped = [...fillResult.value.skipped];
    const warnings = [
      ...fillResult.value.warnings,
      ...downloaded.failures.map(formatImageDownloadFailureWarning)
    ];
    if (videoFailures.length > 0) {
      const reason = `${videoFailures.join('；')}，请在闲鱼页面手动上传视频`;
      const existingVideoSkip = skipped.find((item) => item.field === 'video');
      if (existingVideoSkip === undefined) {
        skipped.push({ field: 'video', reason });
      } else {
        existingVideoSkip.reason = `${existingVideoSkip.reason}；${reason}`;
      }
      warnings.push(`部分视频未自动填入：${videoFailures.join('；')}`);
    }
    return { ...fillResult.value, skipped, warnings };
  } finally {
    await Promise.all(
      videoTransfers.map((transfer) =>
        mediaTransferRegistry.release(transfer.sessionId, tab.tabId).catch(() => undefined)
      )
    );
  }
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

async function appendLogSafely(createEntry: () => OperationLogEntry): Promise<void> {
  try {
    await store.appendLog(createEntry());
  } catch {
    console.error('运行记录保存失败');
  }
}

async function handleRuntimeMessage(message: RuntimeMessage): Promise<OperationResult<unknown>> {
  try {
    let value: unknown;
    switch (message.type) {
      case 'PARSE_PRODUCT':
        value = await parseProduct(message);
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
    await appendLogSafely(() =>
      createSuccessLogEntry(message, value, crypto.randomUUID(), new Date().toISOString())
    );
    return { ok: true, value };
  } catch (error) {
    const messageText = error instanceof Error ? error.message : '操作失败';
    const code = codeFor(message, error);
    await appendLogSafely(() =>
      createFailureLogEntry(
        message,
        messageText,
        code,
        crypto.randomUUID(),
        new Date().toISOString()
      )
    );
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

function registerMediaTransferPort(port: Browser.runtime.Port): void {
  if (port.name !== MEDIA_TRANSFER_PORT_NAME) {
    port.disconnect();
    return;
  }
  const tabId = isTrustedMediaTransferSender(port.sender ?? {}, browser.runtime.id);
  if (tabId === null) {
    port.disconnect();
    return;
  }
  let activeSessionId: string | undefined;
  let reading = false;
  let disconnected = false;

  const releaseActiveSession = async (): Promise<void> => {
    if (activeSessionId === undefined) {
      return;
    }
    const sessionId = activeSessionId;
    activeSessionId = undefined;
    await mediaTransferRegistry.release(sessionId, tabId).catch(() => undefined);
  };
  const disconnect = async (): Promise<void> => {
    await releaseActiveSession();
    if (!disconnected) {
      disconnected = true;
      port.disconnect();
    }
  };
  port.onDisconnect.addListener(() => {
    disconnected = true;
    void releaseActiveSession();
  });
  port.onMessage.addListener((value: unknown) => {
    if (!isMediaTransferClientRequest(value)) {
      void disconnect();
      return;
    }
    if (activeSessionId !== undefined && value.sessionId !== activeSessionId) {
      void disconnect();
      return;
    }
    activeSessionId = value.sessionId;
    if (value.type === 'CLOSE') {
      void disconnect();
      return;
    }
    if (reading) {
      port.postMessage({
        type: 'ERROR',
        sessionId: value.sessionId,
        message: '媒体传输分块请求尚未完成'
      });
      void disconnect();
      return;
    }
    reading = true;
    void mediaTransferRegistry
      .read(value.sessionId, tabId, value.offset)
      .then(
        (chunk) => {
          if (!disconnected) {
            port.postMessage({ type: 'CHUNK', chunk });
          }
          if (chunk.done) {
            activeSessionId = undefined;
          }
        },
        (error: unknown) => {
          if (!disconnected) {
            port.postMessage({
              type: 'ERROR',
              sessionId: value.sessionId,
              message: error instanceof Error ? error.message : '媒体传输失败'
            });
          }
          void disconnect();
        }
      )
      .finally(() => {
        reading = false;
      });
  });
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
  browser.runtime.onConnect.addListener(registerMediaTransferPort);
  browser.tabs.onRemoved.addListener((tabId) => mediaTransferRegistry.releaseForTab(tabId));
}

export { XIANYU_PUBLISH_URL };
