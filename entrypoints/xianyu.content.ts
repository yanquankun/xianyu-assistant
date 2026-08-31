import type { RuntimeMessage } from '../src/domain/messages';
import type { XianyuFillPayload } from '../src/xianyu/fill';
import { fillXianyuDraft, isXianyuFillPayload } from '../src/xianyu/fill';
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
    'payload' in value &&
    isXianyuFillPayload(value.payload)
  );
}

export default defineContentScript({
  matches: ['https://www.goofish.com/*'],
  runAt: 'document_idle',
  main() {
    const scope = globalThis as typeof globalThis & {
      __xianyuAssistantContentReady?: boolean;
    };
    if (scope.__xianyuAssistantContentReady === true) {
      return;
    }
    scope.__xianyuAssistantContentReady = true;
    browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
      if (sender.id !== browser.runtime.id) {
        return undefined;
      }
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
              error: {
                code: 'XIANYU_FILL_FAILED',
                message: error instanceof Error ? error.message : '闲鱼表单填写失败',
                recovery: '请检查闲鱼页面字段后重试',
                draftPreserved: true
              }
            })
        );
        return true;
      }
      return undefined;
    });
  }
});
