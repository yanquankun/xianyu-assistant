export type XianyuLoginState = 'logged-in' | 'logged-out' | 'unknown';

export interface XianyuLoginCheckResult {
  state: XianyuLoginState;
  message: string;
}

export const MAX_XIANYU_LOGIN_CHECK_MESSAGE_LENGTH = 300;

export function parseXianyuLoginState(value: unknown): XianyuLoginState | null {
  return value === 'logged-in' || value === 'logged-out' || value === 'unknown' ? value : null;
}

function isSafeLoginMessage(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= MAX_XIANYU_LOGIN_CHECK_MESSAGE_LENGTH &&
    !hasControlCharacter(value)
  );
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

export function parseXianyuLoginCheckResult(value: unknown): XianyuLoginCheckResult | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const state = parseXianyuLoginState(record.state);
  return state !== null && isSafeLoginMessage(record.message)
    ? { state, message: record.message }
    : null;
}

function isXianyuUrl(value: string): boolean {
  try {
    return new URL(value).hostname.toLowerCase() === 'www.goofish.com';
  } catch {
    return false;
  }
}

function hasExactButtonText(document: Document, text: string): boolean {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).some(
    (button) => button.innerText.trim() === text
  );
}

function hasXianyuPathLink(document: Document, pathname: string): boolean {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).some((anchor) => {
    const href = anchor.getAttribute('href');
    if (href === null) {
      return false;
    }
    try {
      const url = new URL(href, 'https://www.goofish.com');
      return url.hostname.toLowerCase() === 'www.goofish.com' && url.pathname === pathname;
    } catch {
      return false;
    }
  });
}

export function detectLoginState(document: Document, pageUrl: string): XianyuLoginState {
  if (!isXianyuUrl(pageUrl)) {
    return 'unknown';
  }

  const url = new URL(pageUrl);
  const hasLoginPanel =
    document.querySelector('[data-testid="login-panel"], [class*="login-container"]') !== null;
  const hasLoginButton =
    document.querySelector('[data-testid="login-button"]') !== null ||
    hasExactButtonText(document, '登录');
  if (url.pathname.startsWith('/login') || (hasLoginPanel && hasLoginButton)) {
    return 'logged-out';
  }

  const hasUserMarker =
    document.querySelector('[data-user-id], [data-testid="user-avatar"], [class*="user-avatar"]') !==
      null || hasXianyuPathLink(document, '/personal');
  const hasPublishForm =
    document.querySelector('form[data-testid="publish-form"], input[name="title"], textarea[name="description"]') !==
    null;
  if (hasUserMarker || (url.pathname.startsWith('/publish') && hasPublishForm)) {
    return 'logged-in';
  }
  return 'unknown';
}
