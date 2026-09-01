import type { ProductPageReadiness } from '../domain/product-readiness';

export type { ProductPageReadiness } from '../domain/product-readiness';

export interface ProductReadinessOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

const DEFAULT_INTERVAL_MS = 250;
const DEFAULT_TIMEOUT_MS = 10_000;
const TIMEOUT_MESSAGE = '商品页面尚未准备完成，请稍后重试';

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

export function isProductPageReadiness(value: unknown): value is ProductPageReadiness {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.state === 'ready' || record.state === 'waiting') {
    return Object.keys(record).length === 1;
  }
  return (
    record.state === 'failed' &&
    typeof record.message === 'string' &&
    record.message.trim().length > 0 &&
    typeof record.code === 'string' &&
    record.code.trim().length > 0 &&
    Object.keys(record).every((key) => key === 'state' || key === 'message' || key === 'code')
  );
}

export async function waitForProductPageReady(
  probe: () => Promise<ProductPageReadiness>,
  options: ProductReadinessOptions = {}
): Promise<void> {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();

  for (;;) {
    const readiness = await probe();
    if (readiness.state === 'ready') {
      return;
    }
    if (readiness.state === 'failed') {
      throw new Error(readiness.message);
    }
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= timeoutMs) {
      throw new Error(TIMEOUT_MESSAGE);
    }
    await delay(Math.min(intervalMs, timeoutMs - elapsedMs));
  }
}
