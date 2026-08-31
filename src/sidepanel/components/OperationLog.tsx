import type { OperationLogEntry } from '../../storage/operation-log';

interface OperationLogProps {
  entries: readonly OperationLogEntry[];
}

export function OperationLog({ entries }: OperationLogProps) {
  return (
    <section className="editor-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">仅保存在当前浏览器</span>
          <h2>运行记录</h2>
        </div>
      </div>
      {entries.length === 0 ? (
        <p className="empty-note">尚无运行记录。</p>
      ) : (
        <ol className="log-list">
          {[...entries].reverse().map((entry) => (
            <li key={entry.id}>
              <span className={`log-outcome log-outcome--${entry.outcome}`} />
              <div>
                <strong>{entry.message}</strong>
                <time dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleString('zh-CN')}</time>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
