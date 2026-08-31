export interface XianyuContentDependencies {
  waitForComplete(tabId: number): Promise<void>;
  getTabUrl(tabId: number): Promise<string | undefined>;
  sendMessage<T>(tabId: number, message: unknown): Promise<T>;
  inject(tabId: number): Promise<void>;
}

function isXianyuPage(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  try {
    return new URL(value).hostname.toLowerCase() === 'www.goofish.com';
  } catch {
    return false;
  }
}

export async function sendXianyuMessage<T>(
  dependencies: XianyuContentDependencies,
  tabId: number,
  message: unknown
): Promise<T> {
  await dependencies.waitForComplete(tabId);
  const tabUrl = await dependencies.getTabUrl(tabId);
  if (!isXianyuPage(tabUrl)) {
    throw new Error('目标标签页已离开闲鱼，请重新操作');
  }
  try {
    return await dependencies.sendMessage<T>(tabId, message);
  } catch {
    await dependencies.inject(tabId);
    return dependencies.sendMessage<T>(tabId, message);
  }
}
