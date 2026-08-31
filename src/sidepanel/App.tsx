import { useEffect, useReducer, useRef, useState } from 'react';

import type { AiConnectionResult } from '../ai/client';
import type { ExpansionPreview as ExpansionPreviewValue } from '../ai/validation';
import type { ParsedProduct, ProductDraft } from '../domain/product';
import type { AiSettings } from '../domain/settings';
import type { OperationLogEntry } from '../storage/operation-log';
import type { FillResult } from '../xianyu/fill';
import type { XianyuLoginState } from '../xianyu/login';
import { AiSettingsForm } from './components/AiSettingsForm';
import { ExpansionPreview } from './components/ExpansionPreview';
import { LoginBanner } from './components/LoginBanner';
import { OperationLog } from './components/OperationLog';
import { ProductEditor } from './components/ProductEditor';
import { createManualDraft, initialWorkflowState, reduceWorkflow, type PanelView } from './state';

export type PanelSide = 'left' | 'right' | 'unknown';

export interface SidePanelServices {
  loadSettings(): Promise<AiSettings | null>;
  saveSettings(settings: AiSettings): Promise<void>;
  loadDraft(): Promise<ProductDraft | null>;
  saveDraft(draft: ProductDraft): Promise<void>;
  parseProduct(url: string): Promise<ParsedProduct>;
  testAiConnection(settings: AiSettings): Promise<AiConnectionResult>;
  expandDraft(settings: AiSettings, draft: ProductDraft): Promise<ExpansionPreviewValue>;
  checkXianyuLogin(): Promise<XianyuLoginState>;
  fillDraft(draft: ProductDraft): Promise<FillResult>;
  openXianyuLogin(): Promise<void>;
  getPanelSide(): Promise<PanelSide>;
  loadLogs(): Promise<OperationLogEntry[]>;
}

const EMPTY_SETTINGS: AiSettings = {
  baseUrl: '',
  apiKey: '',
  model: '',
  temperature: 0.3,
  systemInstruction: ''
};

const NAVIGATION: { id: PanelView; label: string }[] = [
  { id: 'product', label: '商品整理' },
  { id: 'settings', label: 'AI 配置' },
  { id: 'logs', label: '运行记录' }
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请重试';
}

function operationId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `operation-${String(Date.now())}`;
}

export function App({ services }: { services: SidePanelServices }) {
  const [state, dispatch] = useReducer(reduceWorkflow, initialWorkflowState);
  const [settings, setSettings] = useState<AiSettings>(EMPTY_SETTINGS);
  const [settingsStatus, setSettingsStatus] = useState('');
  const [logs, setLogs] = useState<OperationLogEntry[]>([]);
  const [panelSide, setPanelSide] = useState<PanelSide>('unknown');
  const draftSaveQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      const [storedSettings, storedDraft, loginState, side, entries] = await Promise.all([
        services.loadSettings(),
        services.loadDraft(),
        services.checkXianyuLogin(),
        services.getPanelSide(),
        services.loadLogs()
      ]);
      if (!active) {
        return;
      }
      if (storedSettings !== null) {
        setSettings(storedSettings);
      }
      if (storedDraft !== null) {
        dispatch({ type: 'DRAFT_RESTORED', draft: storedDraft });
      }
      dispatch({ type: 'LOGIN_STATE_CHANGED', loginState });
      setPanelSide(side);
      setLogs(entries);
    };
    void initialize().catch((error: unknown) => {
      if (active) {
        dispatch({ type: 'OPERATION_FAILED', message: errorMessage(error) });
      }
    });
    return () => {
      active = false;
    };
  }, [services]);

  useEffect(() => {
    if (state.draft === null) {
      return;
    }
    const draft = state.draft;
    draftSaveQueue.current = draftSaveQueue.current
      .catch(() => undefined)
      .then(() => services.saveDraft(draft));
    void draftSaveQueue.current.catch((error: unknown) => {
      dispatch({ type: 'OPERATION_FAILED', message: `草稿保存失败：${errorMessage(error)}` });
    });
  }, [services, state.draft]);

  useEffect(() => {
    if (state.activeView !== 'logs') {
      return;
    }
    let active = true;
    void services.loadLogs().then(
      (entries) => {
        if (active) {
          setLogs(entries);
        }
      },
      () => undefined
    );
    return () => {
      active = false;
    };
  }, [services, state.activeView]);

  const parseProduct = async () => {
    const id = operationId();
    dispatch({ type: 'PARSE_STARTED', operationId: id, url: state.sourceUrl });
    try {
      const product = await services.parseProduct(state.sourceUrl);
      dispatch({
        type: 'PARSE_SUCCEEDED',
        operationId: id,
        product,
        now: new Date().toISOString()
      });
    } catch (error) {
      dispatch({ type: 'PARSE_FAILED', operationId: id, message: errorMessage(error) });
    }
  };

  const expandDraft = async () => {
    if (state.draft === null) {
      return;
    }
    dispatch({ type: 'EXPANSION_STARTED' });
    try {
      const preview = await services.expandDraft(settings, state.draft);
      dispatch({ type: 'EXPANSION_RECEIVED', preview });
    } catch (error) {
      dispatch({ type: 'OPERATION_FAILED', message: errorMessage(error) });
    }
  };

  const fillDraft = async () => {
    if (state.draft === null) {
      return;
    }
    dispatch({ type: 'FILL_STARTED' });
    try {
      const result = await services.fillDraft(state.draft);
      const skipped = result.skipped.length;
      dispatch({
        type: 'FILL_FINISHED',
        message:
          skipped === 0
            ? '内容已填入闲鱼，请检查页面并手动发布'
            : `已填写部分内容，${String(skipped)} 个字段需要手动处理`
      });
      dispatch({ type: 'LOGIN_STATE_CHANGED', loginState: 'logged-in' });
    } catch (error) {
      dispatch({ type: 'OPERATION_FAILED', message: errorMessage(error) });
      const loginState = await services.checkXianyuLogin().catch(() => 'unknown' as const);
      dispatch({ type: 'LOGIN_STATE_CHANGED', loginState });
    }
  };

  const saveSettings = async () => {
    try {
      await services.saveSettings(settings);
      setSettingsStatus('配置已保存在当前浏览器');
    } catch (error) {
      setSettingsStatus(errorMessage(error));
    }
  };

  const testConnection = async () => {
    setSettingsStatus('正在测试连接');
    try {
      const result = await services.testAiConnection(settings);
      setSettingsStatus(`连接成功，模型：${result.model}`);
    } catch (error) {
      setSettingsStatus(errorMessage(error));
    }
  };

  const createManualEntry = () => {
    const draft = createManualDraft(operationId(), new Date().toISOString());
    dispatch({ type: 'DRAFT_RESTORED', draft });
  };

  const isBusy =
    state.phase === 'parsing' || state.phase === 'expanding' || state.phase === 'filling';
  const selectedImages = state.draft?.images.filter((image) => image.selected) ?? [];
  const draftReadyToFill =
    state.draft !== null &&
    state.draft.title.trim().length > 0 &&
    state.draft.description.trim().length > 0 &&
    state.draft.price !== null &&
    Number.isFinite(state.draft.price) &&
    state.draft.price > 0 &&
    (state.draft.originalPrice === undefined ||
      (Number.isFinite(state.draft.originalPrice) && state.draft.originalPrice > 0)) &&
    selectedImages.length > 0 &&
    selectedImages.every((image) => image.loadStatus === 'loaded');
  const fillDisabled = !draftReadyToFill || isBusy || state.loginState === 'logged-out';
  const expansionDisabled =
    state.draft === null ||
    isBusy ||
    (state.draft.title.trim().length === 0 && state.draft.description.trim().length === 0);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true">
          闲
        </div>
        <div className="brand-copy">
          <strong>闲鱼上架助手</strong>
          <span>整理商品，确认后填表</span>
        </div>
      </header>

      <nav className="view-tabs" aria-label="主要功能">
        {NAVIGATION.map((item) => (
          <button
            className={state.activeView === item.id ? 'view-tab view-tab--active' : 'view-tab'}
            type="button"
            key={item.id}
            onClick={() => dispatch({ type: 'VIEW_CHANGED', view: item.id })}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <main className="app-main">
        {panelSide === 'left' ? (
          <aside className="panel-note">
            侧边栏位置由 Chrome 控制。如需放在右侧，请在 Chrome 侧边栏设置中切换。
          </aside>
        ) : null}

        {state.activeView === 'product' ? (
          <>
            <LoginBanner state={state.loginState} onLogin={() => void services.openXianyuLogin()} />
            <section className="source-card">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">淘宝与京东</span>
                  <h1>从商品链接开始</h1>
                </div>
                <span className="step-number">01</span>
              </div>
              <div className="field">
                <label htmlFor="source-url">商品链接</label>
                <div className="input-action">
                  <input
                    id="source-url"
                    type="url"
                    value={state.sourceUrl}
                    placeholder="粘贴淘宝或京东商品链接"
                    onChange={(event) =>
                      dispatch({ type: 'SOURCE_URL_CHANGED', url: event.target.value })
                    }
                  />
                  <button
                    className="button button--primary"
                    type="button"
                    disabled={state.sourceUrl.trim().length === 0 || isBusy}
                    onClick={() => void parseProduct()}
                  >
                    解析商品
                  </button>
                </div>
              </div>
              <p className="inline-status" aria-live="polite">
                {state.statusMessage}
              </p>
              {state.draft === null ? (
                <button className="button button--quiet" type="button" onClick={createManualEntry}>
                  手动填写
                </button>
              ) : null}
              {state.errorMessage === null ? null : (
                <p className="error-message">{state.errorMessage}</p>
              )}
            </section>

            {state.draft === null ? (
              <section className="empty-state">
                <span className="empty-state__index">02</span>
                <h2>编辑与扩写</h2>
                <p>解析商品，或选择手动填写，再编辑标题、价格和描述。</p>
              </section>
            ) : (
              <ProductEditor
                draft={state.draft}
                onChange={(draft) => dispatch({ type: 'DRAFT_CHANGED', draft })}
                onImageToggle={(id) => dispatch({ type: 'IMAGE_SELECTION_TOGGLED', id })}
                onImageLoadStatus={(id, loadStatus) =>
                  dispatch({ type: 'IMAGE_LOAD_STATUS_CHANGED', id, loadStatus })
                }
              />
            )}

            {state.expansionPreview === null ? null : (
              <ExpansionPreview
                preview={state.expansionPreview}
                onApply={() =>
                  dispatch({ type: 'EXPANSION_APPLIED', now: new Date().toISOString() })
                }
                onDiscard={() => dispatch({ type: 'EXPANSION_DISCARDED' })}
              />
            )}
          </>
        ) : null}

        {state.activeView === 'settings' ? (
          <AiSettingsForm
            settings={settings}
            status={settingsStatus}
            onChange={setSettings}
            onSave={() => void saveSettings()}
            onTest={() => void testConnection()}
          />
        ) : null}

        {state.activeView === 'logs' ? <OperationLog entries={logs} /> : null}
      </main>

      <footer className="action-dock">
        <p>最终发布需在闲鱼页面手动完成</p>
        <div className="button-row">
          <button
            className="button button--secondary"
            type="button"
            disabled={expansionDisabled}
            onClick={() => void expandDraft()}
          >
            AI 扩写
          </button>
          <button
            className="button button--primary button--wide"
            type="button"
            disabled={fillDisabled}
            onClick={() => void fillDraft()}
          >
            填入闲鱼
          </button>
        </div>
      </footer>
    </div>
  );
}
