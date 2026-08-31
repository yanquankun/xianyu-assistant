import type { AiSettings } from '../../domain/settings';

interface AiSettingsFormProps {
  settings: AiSettings;
  status: string;
  onChange: (settings: AiSettings) => void;
  onSave: () => void;
  onTest: () => void;
}

export function AiSettingsForm({ settings, status, onChange, onSave, onTest }: AiSettingsFormProps) {
  const update = (changes: Partial<AiSettings>) => onChange({ ...settings, ...changes });
  return (
    <section className="editor-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">OpenAI 兼容接口</span>
          <h2>AI 配置</h2>
        </div>
      </div>
      <label className="field">
        <span>Base URL</span>
        <input
          type="url"
          value={settings.baseUrl}
          placeholder="https://api.example.com/v1"
          onChange={(event) => update({ baseUrl: event.target.value })}
        />
      </label>
      <label className="field">
        <span>API Key</span>
        <input
          type="password"
          value={settings.apiKey}
          autoComplete="off"
          placeholder="仅保存在当前浏览器"
          onChange={(event) => update({ apiKey: event.target.value })}
        />
      </label>
      <label className="field">
        <span>Model</span>
        <input value={settings.model} onChange={(event) => update({ model: event.target.value })} />
      </label>
      <label className="field">
        <span>Temperature</span>
        <input
          type="number"
          min="0"
          max="2"
          step="0.1"
          value={settings.temperature}
          onChange={(event) => update({ temperature: Number(event.target.value) })}
        />
      </label>
      <label className="field">
        <span>补充要求</span>
        <textarea
          rows={5}
          value={settings.systemInstruction}
          placeholder="例如：语气简洁，避免夸张表达"
          onChange={(event) => update({ systemInstruction: event.target.value })}
        />
      </label>
      <p className="privacy-note">API Key 保存在扩展本地存储，不会提交到项目仓库。</p>
      <div className="button-row">
        <button className="button button--secondary" type="button" onClick={onTest}>
          测试连接
        </button>
        <button className="button button--primary" type="button" onClick={onSave}>
          保存配置
        </button>
      </div>
      {status.length > 0 ? <p className="inline-status">{status}</p> : null}
    </section>
  );
}
