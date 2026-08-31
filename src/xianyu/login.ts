export type XianyuLoginState = 'logged-in' | 'logged-out' | 'unknown';

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
    null;
  const hasPublishForm =
    document.querySelector('form[data-testid="publish-form"], input[name="title"], textarea[name="description"]') !==
    null;
  if (hasUserMarker || (url.pathname.startsWith('/publish') && hasPublishForm)) {
    return 'logged-in';
  }
  return 'unknown';
}
