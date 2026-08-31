import type { XianyuLoginState } from '../../xianyu/login';

interface LoginBannerProps {
  state: XianyuLoginState;
  message: string;
  isRefreshing: boolean;
  onRefresh: () => void;
  onLogin: () => void;
}

const LABELS: Record<XianyuLoginState, string> = {
  'logged-in': '闲鱼已登录',
  'logged-out': '需要登录闲鱼',
  unknown: '尚未确认闲鱼登录状态'
};

function defaultMessage(state: XianyuLoginState): string {
  return state === 'logged-out'
    ? '请先完成闲鱼网页登录，草稿会保留在本地。'
    : '填表前会再次检查当前页面。';
}

export function LoginBanner({ state, message, isRefreshing, onRefresh, onLogin }: LoginBannerProps) {
  return (
    <section className={`login-banner login-banner--${state}`} aria-live="polite">
      <span className="status-dot" aria-hidden="true" />
      <div>
        <strong>{LABELS[state]}</strong>
        <p>{message || defaultMessage(state)}</p>
      </div>
      <button
        className="button button--quiet"
        type="button"
        aria-label="刷新闲鱼登录状态"
        aria-busy={isRefreshing}
        disabled={isRefreshing}
        onClick={onRefresh}
      >
        {isRefreshing ? <span className="ai-expansion-spinner" aria-hidden="true" /> : null}
        刷新
      </button>
      {state === 'logged-out' ? (
        <button className="button button--quiet" type="button" onClick={onLogin}>
          打开登录页
        </button>
      ) : null}
    </section>
  );
}
