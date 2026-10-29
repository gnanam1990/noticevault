/**
 * @noticevault/api — typed API errors
 *
 * All errors include a machine-readable `code` field.
 * HTTP status codes are determined by the error class, not by the caller.
 */

export interface ApiErrorBody {
  readonly error: {
    readonly code:    string;
    readonly message: string;
    readonly detail?: unknown;
  };
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code:       string;
  readonly detail?:    unknown;

  constructor(statusCode: number, code: string, message: string, detail?: unknown) {
    super(message);
    this.name       = "ApiError";
    this.statusCode = statusCode;
    this.code       = code;
    this.detail     = detail;
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code:    this.code,
        message: this.message,
        ...(this.detail !== undefined ? { detail: this.detail } : {}),
      },
    };
  }
}

// ── Named constructors ────────────────────────────────────────────────────────

export function badRequest(message: string, detail?: unknown): ApiError {
  return new ApiError(400, "BAD_REQUEST", message, detail);
}

export function unauthorized(message = "Authentication required"): ApiError {
  return new ApiError(401, "UNAUTHORIZED", message);
}

export function forbidden(message = "Forbidden"): ApiError {
  return new ApiError(403, "FORBIDDEN", message);
}

export function notFound(resource: string, id: string): ApiError {
  return new ApiError(404, "NOT_FOUND", `${resource} not found: ${id}`);
}

export function conflict(message: string, detail?: unknown): ApiError {
  return new ApiError(409, "CONFLICT", message, detail);
}

export function unprocessable(message: string, detail?: unknown): ApiError {
  return new ApiError(422, "UNPROCESSABLE", message, detail);
}

export function internalError(message = "Internal server error"): ApiError {
  return new ApiError(500, "INTERNAL_ERROR", message);
}
