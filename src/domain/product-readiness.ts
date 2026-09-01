export type ProductPageReadiness =
  | { state: 'ready' }
  | { state: 'waiting' }
  | { state: 'failed'; message: string; code: string };
