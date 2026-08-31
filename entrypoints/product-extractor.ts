import { parseProductDocument } from '../src/parsers/common';

interface ExtractProductDocumentMessage {
  type: 'EXTRACT_PRODUCT_DOCUMENT';
}

function isExtractMessage(value: unknown): value is ExtractProductDocumentMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'EXTRACT_PRODUCT_DOCUMENT'
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
    sendResponse(parseProductDocument(document, window.location.href));
    return true;
  });
});
