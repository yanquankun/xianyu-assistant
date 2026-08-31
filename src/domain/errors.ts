export type AppErrorCode =
  | 'INVALID_URL'
  | 'PERMISSION_DENIED'
  | 'PARSE_TIMEOUT'
  | 'PARSE_FAILED'
  | 'AI_CONFIG_INVALID'
  | 'AI_UNAUTHORIZED'
  | 'AI_RATE_LIMITED'
  | 'AI_INVALID_RESPONSE'
  | 'AI_NETWORK_ERROR'
  | 'XIANYU_LOGGED_OUT'
  | 'XIANYU_LOGIN_UNKNOWN'
  | 'XIANYU_FIELD_MISSING'
  | 'XIANYU_IMAGE_FAILED'
  | 'XIANYU_FILL_FAILED'
  | 'OPERATION_CANCELLED';

export interface AppError {
  code: AppErrorCode;
  message: string;
  recovery: string;
  draftPreserved: boolean;
}

export type OperationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AppError };
