import { useState } from 'react';

import type { OperationDraftSnapshot, OperationLogEntry } from '../../storage/operation-log';

interface OperationLogProps {
  entries: readonly OperationLogEntry[];
}

const OUTCOME_LABELS = {
  success: '成功',
  failure: '失败',
  warning: '警告'
} as const;

function getDisplayTitle(entry: OperationLogEntry): string {
  const displayTitle = entry.displayTitle?.trim();
  if (displayTitle !== undefined && displayTitle.length > 0) {
    return displayTitle;
  }
  const operationLabel = entry.operationLabel?.trim();
  return operationLabel === undefined || operationLabel.length === 0 ? entry.message : operationLabel;
}

function safeHttpUrl(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return undefined;
    }
    url.username = '';
    url.password = '';
    return url.href;
  } catch {
    return undefined;
  }
}

function DraftDetails({ draft }: { draft: OperationDraftSnapshot }) {
  const sourceUrl = safeHttpUrl(draft.sourceUrl);
  const [copyFeedback, setCopyFeedback] = useState('');

  const copySourceUrl = async () => {
    if (sourceUrl === undefined) {
      return;
    }
    try {
      await navigator.clipboard.writeText(sourceUrl);
      setCopyFeedback('链接已复制');
    } catch {
      setCopyFeedback('复制失败，请手动选择链接');
    }
  };

  const openSourceUrl = () => {
    if (sourceUrl === undefined) {
      return;
    }
    const opened = window.open(sourceUrl, '_blank', 'noopener,noreferrer');
    if (opened !== null) {
      opened.opener = null;
    }
  };

  return (
    <dl className="log-details__fields">
      {sourceUrl === undefined ? null : (
        <div>
          <dt>来源链接</dt>
          <dd>
            <span className="log-details__link">{sourceUrl}</span>
            <span className="log-details__link-actions">
              <button type="button" onClick={() => void copySourceUrl()}>
                复制链接
              </button>
              <button type="button" onClick={openSourceUrl}>
                新窗口打开
              </button>
            </span>
            {copyFeedback.length === 0 ? null : <p role="status">{copyFeedback}</p>}
          </dd>
        </div>
      )}
      {draft.title === undefined ? null : (
        <div>
          <dt>标题</dt>
          <dd>{draft.title}</dd>
        </div>
      )}
      {draft.price === undefined ? null : (
        <div>
          <dt>售价</dt>
          <dd>{draft.price}</dd>
        </div>
      )}
      {draft.originalPrice === undefined ? null : (
        <div>
          <dt>原价</dt>
          <dd>{draft.originalPrice}</dd>
        </div>
      )}
      {draft.description === undefined ? null : (
        <div>
          <dt>描述</dt>
          <dd className="log-details__description">{draft.description}</dd>
        </div>
      )}
      {draft.shippingMethod === undefined ? null : (
        <div>
          <dt>发货方式</dt>
          <dd>{draft.shippingMethod}</dd>
        </div>
      )}
      {draft.categoryNote === undefined ? null : (
        <div>
          <dt>分类备注</dt>
          <dd>{draft.categoryNote}</dd>
        </div>
      )}
      {draft.selectedImageCount === undefined ? null : (
        <div>
          <dt>已选图片</dt>
          <dd>{draft.selectedImageCount} 张</dd>
        </div>
      )}
      {draft.videoName === undefined ? null : (
        <div>
          <dt>视频</dt>
          <dd>{draft.videoName}</dd>
        </div>
      )}
    </dl>
  );
}

function LogDetails({ entry }: { entry: OperationLogEntry }) {
  const details = entry.details;
  if (details === undefined) {
    return <p className="empty-note">这条旧记录没有可展开的详情。</p>;
  }
  return (
    <div className="log-details">
      {details.draft === undefined ? null : <DraftDetails draft={details.draft} />}
      {details.warnings === undefined || details.warnings.length === 0 ? null : (
        <div className="log-details__section">
          <h3>警告</h3>
          <ul>
            {details.warnings.map((warning, index) => (
              <li key={`${entry.id}-warning-${String(index)}`}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
      {details.result === undefined ? null : (
        <div className="log-details__section">
          <h3>执行结果</h3>
          <p>{details.result}</p>
        </div>
      )}
      {details.error === undefined ? null : (
        <div className="log-details__section">
          <h3>失败原因</h3>
          <p>{details.error}</p>
        </div>
      )}
    </div>
  );
}

export function OperationLog({ entries }: OperationLogProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
          {[...entries].reverse().map((entry) => {
            const isExpanded = expandedId === entry.id;
            const detailsId = `operation-log-details-${entry.id}`;
            const title = getDisplayTitle(entry);
            return (
              <li key={entry.id} className="log-list__item">
                <span className={`log-outcome log-outcome--${entry.outcome}`} />
                <div className="log-list__content">
                  <button
                    aria-controls={detailsId}
                    aria-expanded={isExpanded}
                    className="log-list__toggle"
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  >
                    <strong>{title}</strong>
                    <span>
                      {entry.operationLabel ?? entry.message} · {OUTCOME_LABELS[entry.outcome]} ·{' '}
                      <time dateTime={entry.timestamp}>
                        {new Date(entry.timestamp).toLocaleString('zh-CN')}
                      </time>
                    </span>
                  </button>
                  {isExpanded ? (
                    <div id={detailsId} className="log-list__details">
                      <LogDetails entry={entry} />
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
