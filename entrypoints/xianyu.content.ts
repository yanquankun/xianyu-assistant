import type { RuntimeMessage } from '../src/domain/messages';
import type { XianyuFillPayload } from '../src/xianyu/fill';
import { fillXianyuDraft } from '../src/xianyu/fill';
import { detectLoginState } from '../src/xianyu/login';

interface FillMessage {
  type: 'FILL_XIANYU_FORM';
  payload: XianyuFillPayload;
}

function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  return typeof value === 'object' && value !== null && 'type' in value;
}

function isFillMessage(value: unknown): value is FillMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'FILL_XIANYU_FORM' &&
    'payload' in value
  );
}

export default defineContentScript({
  matches: ['https://www.goofish.com/*'],
  runAt: 'document_idle',
  main() {
    browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      if (isRuntimeMessage(message) && message.type === 'CHECK_XIANYU_LOGIN') {
        sendResponse(detectLoginState(document, window.location.href));
        return true;
      }
      if (isFillMessage(message)) {
        void fillXianyuDraft(document, message.payload).then(
          (result) => sendResponse({ ok: true, value: result }),
          (error: unknown) =>
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : '闲鱼表单填写失败'
            })
        );
        return true;
      }
      return undefined;
    });
  }
});
