import {
  checkProductPageReadiness,
  extractProductDocument
} from '../src/parsers/common';

interface ExtractProductDocumentMessage {
  type: 'EXTRACT_PRODUCT_DOCUMENT';
  hintedTitle?: string;
}

interface CheckProductPageReadinessMessage {
  type: 'CHECK_PRODUCT_PAGE_READINESS';
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

function isReadinessMessage(value: unknown): value is CheckProductPageReadinessMessage {
  return (
    isRecord(value) &&
    value.type === 'CHECK_PRODUCT_PAGE_READINESS' &&
    Object.keys(value).length === 1
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
    if (sender.id !== browser.runtime.id) {
      return undefined;
    }
    if (isReadinessMessage(message)) {
      sendResponse(checkProductPageReadiness(document, window.location.href));
      return undefined;
    }
    if (!isExtractMessage(message)) {
      return undefined;
    }
    void extractProductDocument(document, window.location.href, message.hintedTitle).then(
      sendResponse,
      (error: unknown) =>
        sendResponse({
          ok: false,
          error: {
            message: error instanceof Error ? error.message : '商品解析失败',
            code: 'PARSE_FAILED'
          }
        })
    );
    return true;
  });
});
