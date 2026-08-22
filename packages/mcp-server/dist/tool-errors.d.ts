export declare const KNOWN_ERROR_CODES: Set<string>;
/** Stable code returned when the trust lookup never answered. */
export declare const LOOKUP_TIMEOUT_MESSAGE = "lookup_timeout: the trust lookup did not answer in time \u2014 the payee was NOT checked";
/**
 * Turn an arbitrary thrown value into a string the model may see.
 *
 * Allow-list by design: anything not on the known-code list collapses to
 * `request_failed`, so an upstream stack trace or a URL with a key in it can
 * never reach the transcript.
 */
export declare function sanitizeToolError(error: unknown): string;
