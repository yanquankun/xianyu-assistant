import type { XianyuLoginState } from '../../xianyu/login';

interface LoginBannerProps {
  state: XianyuLoginState;
  onLogin: () => void;
}

const LABELS: Record<XianyuLoginState, string> = {
  'logged-in': '闲鱼已登录',
  'logged-out': '需要登录闲鱼',
  unknown: '尚未确认闲鱼登录状态'
};

export function LoginBanner({ state, onLogin }: LoginBannerProps) {
  return (
    <section className={`login-banner login-banner--${state}`} aria-live="polite">
      <span className="status-dot" aria-hidden="true" />
      <div>
        <strong>{LABELS[state]}</strong>
        <p>
          {state === 'logged-out'
            ? '请先完成闲鱼网页登录，草稿会保留在本地。'
            : '填表前会再次检查当前页面。'}
        </p>
      </div>
      {state === 'logged-out' ? (
        <button className="button button--quiet" type="button" onClick={onLogin}>
          打开登录页
        </button>
      ) : null}
    </section>
  );
}
