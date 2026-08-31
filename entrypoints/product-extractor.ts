import { extractProductDocument } from '../src/parsers/common';

interface ExtractProductDocumentMessage {
  type: 'EXTRACT_PRODUCT_DOCUMENT';
  hintedTitle?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isExtractMessage(value: unknown): value is ExtractProductDocumentMessage {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.type === 'EXTRACT_PRODUCT_DOCUMENT' &&
    Object.keys(value).every((key) => key === 'type' || key === 'hintedTitle') &&
    (value.hintedTitle === undefined ||
      (typeof value.hintedTitle === 'string' &&
        value.hintedTitle.trim().length > 0 &&
        value.hintedTitle.length <= 500))
  );
}

export default defineUnlistedScript(() => {
  const scope = globalThis as typeof globalThis & {
    __xianyuAssistantExtractorReady?: boolean;
  };
  if (scope.__xianyuAssistantExtractorReady === true) {
    return;
  }
  scope.__xianyuAssistantExtractorReady = true;
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!isExtractMessage(message) || sender.id !== browser.runtime.id) {
      return undefined;
    }
    sendResponse(extractProductDocument(document, window.location.href, message.hintedTitle));
    return true;
  });
});
