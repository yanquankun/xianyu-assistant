export interface TextTypewriter {
  push(text: string): void;
  finish(): Promise<void>;
  cancel(): void;
}

const DEFAULT_CHARACTER_INTERVAL_MS = 28;

export function createTextTypewriter(
  onCharacter: (character: string) => void,
  characterIntervalMs = DEFAULT_CHARACTER_INTERVAL_MS
): TextTypewriter {
  const queue: string[] = [];
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });
  let timer: ReturnType<typeof setInterval> | undefined;
  let isFinishing = false;
  let isSettled = false;
  let resolveFinished: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });

  const clearTimer = () => {
    if (timer === undefined) {
      return;
    }
    clearInterval(timer);
    timer = undefined;
  };

  const settleIfFinished = () => {
    if (!isFinishing || queue.length > 0 || isSettled) {
      return;
    }
    clearTimer();
    isSettled = true;
    resolveFinished();
  };

  const emitNext = () => {
    const character = queue.shift();
    if (character !== undefined) {
      onCharacter(character);
    }
    settleIfFinished();
  };

  const start = () => {
    if (timer !== undefined || queue.length === 0 || isSettled) {
      return;
    }
    emitNext();
    if (queue.length === 0) {
      return;
    }
    timer = setInterval(() => {
      emitNext();
      if (queue.length === 0) {
        clearTimer();
      }
    }, characterIntervalMs);
  };

  return {
    push(text) {
      if (text.length === 0 || isFinishing || isSettled) {
        return;
      }
      for (const { segment } of segmenter.segment(text)) {
        queue.push(segment);
      }
      start();
    },

    finish() {
      isFinishing = true;
      start();
      settleIfFinished();
      return finished;
    },

    cancel() {
      if (isSettled) {
        return;
      }
      queue.length = 0;
      isFinishing = true;
      settleIfFinished();
    }
  };
}
