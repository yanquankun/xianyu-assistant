import { ensureProductDestination, normalizeHttpUrl } from './permissions';

export interface SettledBrowserTab {
  id: number;
  url?: string;
  status?: string;
}

export type TabUpdatedListener = (
  tabId: number,
  changeInfo: { status?: string; url?: string },
  tab: SettledBrowserTab
) => void;

export type TabRemovedListener = (tabId: number) => void;

interface ListenerCollection<T> {
  addListener(listener: T): void;
  removeListener(listener: T): void;
}

export interface TabSettledDependencies {
  get(tabId: number): Promise<SettledBrowserTab>;
  onUpdated: ListenerCollection<TabUpdatedListener>;
  onRemoved: ListenerCollection<TabRemovedListener>;
}

export interface TabSettleOptions {
  quietMs?: number;
  timeoutMs?: number;
}

const DEFAULT_QUIET_MS = 800;
const DEFAULT_TIMEOUT_MS = 30_000;

export function waitForTabSettled(
  dependencies: TabSettledDependencies,
  tabId: number,
  submittedUrl: string,
  options: TabSettleOptions = {}
): Promise<SettledBrowserTab> {
  const source = normalizeHttpUrl(submittedUrl);
  const quietMs = options.quietMs ?? DEFAULT_QUIET_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<SettledBrowserTab>((resolve, reject) => {
    let finished = false;
    let current: SettledBrowserTab | undefined;
    let quietTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      clearTimeout(timeoutTimer);
      if (quietTimer !== undefined) {
        clearTimeout(quietTimer);
      }
      dependencies.onUpdated.removeListener(updatedListener);
      dependencies.onRemoved.removeListener(removedListener);
    };
    const finish = (result: SettledBrowserTab | Error): void => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      if (result instanceof Error) {
        reject(result);
      } else {
        resolve(result);
      }
    };
    const validateDestination = (url: string): void => {
      const normalized = normalizeHttpUrl(url);
      if (normalized.href !== source.href) {
        ensureProductDestination(source, normalized.href);
      }
    };
    const scheduleQuietWindow = (): void => {
      if (quietTimer !== undefined) {
        clearTimeout(quietTimer);
      }
      if (current?.status !== 'complete' || current.url === undefined) {
        quietTimer = undefined;
        return;
      }
      const candidate = current;
      quietTimer = setTimeout(() => {
        try {
          ensureProductDestination(source, candidate.url ?? '');
          finish(candidate);
        } catch (error) {
          finish(error instanceof Error ? error : new Error('商品页跳转目标无效'));
        }
      }, quietMs);
    };
    const updatedListener: TabUpdatedListener = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId || finished) {
        return;
      }
      try {
        const nextUrl = changeInfo.url ?? tab.url ?? current?.url;
        if (nextUrl !== undefined) {
          validateDestination(nextUrl);
        }
        current = {
          id: tabId,
          ...(nextUrl === undefined ? {} : { url: nextUrl }),
          ...(changeInfo.status === undefined
            ? tab.status === undefined
              ? {}
              : { status: tab.status }
            : { status: changeInfo.status })
        };
        scheduleQuietWindow();
      } catch (error) {
        finish(error instanceof Error ? error : new Error('商品页跳转目标无效'));
      }
    };
    const removedListener: TabRemovedListener = (removedTabId) => {
      if (removedTabId === tabId) {
        finish(new Error('页面在加载完成前被关闭'));
      }
    };
    const timeoutTimer = setTimeout(() => {
      finish(new Error('页面加载超时，请检查网络后重试'));
    }, timeoutMs);

    dependencies.onUpdated.addListener(updatedListener);
    dependencies.onRemoved.addListener(removedListener);
    void dependencies.get(tabId).then(
      (tab) => {
        if (finished) {
          return;
        }
        current = tab;
        scheduleQuietWindow();
      },
      () => finish(new Error('无法读取目标标签页'))
    );
  });
}
