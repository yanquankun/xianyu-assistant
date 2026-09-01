import type { RuntimeMessage } from '../src/domain/messages';
import type { XianyuFillPayload } from '../src/xianyu/fill';
import { fillXianyuDraft, isXianyuFillPayload } from '../src/xianyu/fill';
import { detectLoginState } from '../src/xianyu/login';
import {
  MEDIA_TRANSFER_PORT_NAME,
  receiveMediaFile,
  type MediaTransferClientPort
} from '../src/xianyu/media-transfer';

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

function connectMediaTransferPort(): MediaTransferClientPort {
  const port = browser.runtime.connect({ name: MEDIA_TRANSFER_PORT_NAME });
  return {
    postMessage: (message) => port.postMessage(message),
    disconnect: () => port.disconnect(),
    onMessage: {
      addListener: (listener) => port.onMessage.addListener(listener),
      removeListener: (listener) => port.onMessage.removeListener(listener)
    },
    onDisconnect: {
      addListener: (listener) => port.onDisconnect.addListener(listener),
      removeListener: (listener) => port.onDisconnect.removeListener(listener)
    }
  };
}

async function fillMessage(document: Document, message: FillMessage) {
  const videoTransfers = await Promise.all(
    (message.payload.videoTransfers ?? []).map(async (descriptor) => {
      try {
        return { file: await receiveMediaFile(descriptor, connectMediaTransferPort) } as const;
      } catch (error) {
        return {
          failure: `${descriptor.fileName}：${error instanceof Error ? error.message : '视频传输失败'}`
        } as const;
      }
    })
  );
  const videoFiles = videoTransfers.flatMap((transfer) =>
    'file' in transfer ? [transfer.file] : []
  );
  const videoTransferFailures = videoTransfers.flatMap((transfer) =>
    'failure' in transfer ? [transfer.failure] : []
  );
  const result = await fillXianyuDraft(document, message.payload, videoFiles);
  if (videoTransferFailures.length === 0) {
    return result;
  }
  const failureMessage = videoTransferFailures.join('；');
  return {
    ...result,
    skipped: result.skipped.map((item) =>
      item.field === 'video'
        ? { ...item, reason: `${failureMessage}，请在闲鱼页面手动上传视频` }
        : item
    ),
    warnings: [...result.warnings, `部分视频未自动填入：${failureMessage}`]
  };
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
        void fillMessage(document, message).then(
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
