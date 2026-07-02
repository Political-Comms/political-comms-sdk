/**
 * Error thrown for any non-success response from the Political Comms API,
 * and for network failures (code "NETWORK_ERROR", statusCode 0).
 *
 * The API returns errors as JSON:
 * `{ success: false, error: string, code: string, statusCode: number }`
 */
export class PoliticalCommsError extends Error {
  /** Machine readable error code, for example "RATE_LIMIT_EXCEEDED". */
  readonly code: string;
  /** HTTP status code of the response. 0 for network failures. */
  readonly statusCode: number;
  /** The raw response body (parsed JSON when possible, otherwise the raw text). */
  readonly body: unknown;

  constructor(message: string, code: string, statusCode: number, body: unknown) {
    super(message);
    this.name = 'PoliticalCommsError';
    this.code = code;
    this.statusCode = statusCode;
    this.body = body;
  }
}
