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
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isExtractMessage(message)) {
      return undefined;
    }
    sendResponse(parseProductDocument(document, window.location.href));
    return true;
  });
});
