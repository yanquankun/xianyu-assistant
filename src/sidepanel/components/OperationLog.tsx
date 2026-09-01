import { useState } from 'react';

import type {
  OperationDraftSnapshot,
  OperationLogEntry,
  OperationSourceSummary
} from '../../storage/operation-log';

interface OperationLogProps {
  entries: readonly OperationLogEntry[];
}

const OUTCOME_LABELS = {
  success: '成功',
  failure: '失败',
  warning: '警告'
} as const;

const PLATFORM_LABELS: Record<OperationSourceSummary['platform'], string> = {
  taobao: '淘宝',
  tmall: '天猫',
  jd: '京东',
  generic: '其他'
};

function getDisplayTitle(entry: OperationLogEntry): string {
  const displayTitle = entry.displayTitle?.trim();
  if (displayTitle !== undefined && displayTitle.length > 0) {
    return displayTitle;
  }
  const operationLabel = entry.operationLabel?.trim();
  return operationLabel === undefined || operationLabel.length === 0
    ? entry.message
    : operationLabel;
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

function SafeUrlRow({ label, url }: { label: string; url: string }) {
  const [copyFeedback, setCopyFeedback] = useState('');

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopyFeedback(`${label}已复制`);
    } catch {
      setCopyFeedback(`${label}复制失败，请手动选择链接`);
    }
  };

  const openUrl = () => {
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (opened !== null) {
      opened.opener = null;
      setCopyFeedback(`${label}已在新窗口打开`);
    } else {
      setCopyFeedback(`无法打开${label}`);
    }
  };

  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <span className="log-details__link">{url}</span>
        <span className="log-details__link-actions">
          <button type="button" onClick={() => void copyUrl()}>
            复制{label}
          </button>
          <button type="button" onClick={openUrl}>
            打开{label}
          </button>
        </span>
        {copyFeedback.length === 0 ? null : <p role="status">{copyFeedback}</p>}
      </dd>
    </div>
  );
}

function DraftDetails({ draft }: { draft: OperationDraftSnapshot }) {
  const sourceUrl = safeHttpUrl(draft.sourceUrl);
  const canonicalUrl = safeHttpUrl(draft.canonicalUrl);
  const duplicateUrl = sourceUrl !== undefined && sourceUrl === canonicalUrl;

  return (
    <dl className="log-details__fields">
      {duplicateUrl ? (
        <SafeUrlRow label="提交链接与最终规范链接" url={sourceUrl} />
      ) : (
        <>
          {sourceUrl === undefined ? null : <SafeUrlRow label="提交链接" url={sourceUrl} />}
          {canonicalUrl === undefined ? null : (
            <SafeUrlRow label="最终规范链接" url={canonicalUrl} />
          )}
        </>
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
          <dt>图片</dt>
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

function SourceDetails({ source }: { source: OperationSourceSummary }) {
  return (
    <dl className="log-details__fields">
      <div>
        <dt>来源平台</dt>
        <dd>{PLATFORM_LABELS[source.platform]}</dd>
      </div>
      <SafeUrlRow label="最终规范链接" url={source.canonicalUrl} />
      {(
        [
          ['标题', source.fields.title],
          ['描述', source.fields.description],
          ['售价', source.fields.price],
          ['原价', source.fields.originalPrice]
        ] as const
      ).map(([label, completed]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{completed ? '已识别' : '未识别'}</dd>
        </div>
      ))}
      <div>
        <dt>商品图</dt>
        <dd>{source.fields.imageCount} 张</dd>
      </div>
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
      {details.source === undefined ? null : <SourceDetails source={details.source} />}
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
  const [expandedEntryKey, setExpandedEntryKey] = useState<string | null>(null);
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
          {entries
            .map((entry, originalIndex) => ({ entry, originalIndex }))
            .reverse()
            .map(({ entry, originalIndex }) => {
              const entryKey = `${entry.id}:${entry.timestamp}:${String(originalIndex)}`;
              const isExpanded = expandedEntryKey === entryKey;
              const detailsId = `operation-log-details-${String(originalIndex)}`;
              const title = getDisplayTitle(entry);
              return (
                <li key={entryKey} className="log-list__item">
                  <span className={`log-outcome log-outcome--${entry.outcome}`} />
                  <div className="log-list__content">
                    <button
                      aria-controls={detailsId}
                      aria-expanded={isExpanded}
                      className="log-list__toggle"
                      type="button"
                      onClick={() => setExpandedEntryKey(isExpanded ? null : entryKey)}
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
