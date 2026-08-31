import type { ExpansionPreview as ExpansionPreviewValue } from '../../ai/validation';

interface ExpansionPreviewProps {
  preview: ExpansionPreviewValue;
  onApply: () => void;
  onDiscard: () => void;
}

export function ExpansionPreview({ preview, onApply, onDiscard }: ExpansionPreviewProps) {
  return (
    <section className="preview-card" aria-label="AI 文案预览">
      <div className="section-heading">
        <div>
          <span className="eyebrow">应用前检查</span>
          <h2>AI 文案预览</h2>
        </div>
      </div>
      <strong>{preview.title}</strong>
      <p className="preview-copy">{preview.description}</p>
      {[...preview.warnings, ...preview.factWarnings].length > 0 ? (
        <ul className="warning-list">
          {[...preview.warnings, ...preview.factWarnings].map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      <div className="button-row">
        <button className="button button--quiet" type="button" onClick={onDiscard}>
          保留原文案
        </button>
        <button className="button button--primary" type="button" onClick={onApply}>
          应用此文案
        </button>
      </div>
    </section>
  );
}
