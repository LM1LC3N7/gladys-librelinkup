// -----------------------------------------------------------------------------
// LibreError: every failure of a request to the LibreLinkUp API, with a code
// the app maps to a status, a retry policy or a message. Messages never carry
// the credentials, the token, a patient name or id, a glucose value nor a URL.
// -----------------------------------------------------------------------------

export const CODES = Object.freeze({
  UNREACHABLE: 'unreachable', // no TCP connection
  TIMEOUT: 'timeout', // no answer in time
  TLS_UNTRUSTED: 'tls_untrusted', // certificate refused
  HTTP: 'http', // an HTTP status other than 2xx (see `status`)
  BAD_ANSWER: 'bad_answer', // not the JSON expected
  TOO_LARGE: 'too_large', // answer above the size cap
  CLOSED: 'closed', // the client was replaced (new configuration)
  REFUSED: 'refused', // the login answered "wrong credentials" (status 2)
  TERMS: 'terms', // the account must accept terms or a policy in the app
  VERSION: 'version', // the API refuses the app version sent (status 920)
  REGION: 'region', // the API sent the account to a region outside the list
});

export class LibreError extends Error {
  constructor(code, message, { status, retryAfterMs, envelope, account, step } = {}) {
    super(message);
    this.name = 'LibreError';
    this.code = code;
    if (status !== undefined) this.status = status;
    if (retryAfterMs !== undefined && retryAfterMs !== null) this.retryAfterMs = retryAfterMs;
    /** The error body was the API's own JSON `{ "status": <number>, ... }`, not a page of a proxy. */
    if (envelope !== undefined) this.envelope = envelope;
    /** The request was the login, or the list after a fresh login (a 401 there is about the credentials). */
    if (account !== undefined) this.account = account;
    /** TERMS: the step the API asks for (`tou`, `pp`, `verifyEmail`...). */
    if (step !== undefined) this.step = step;
  }
}

/**
 * The credentials refused: the login answered "wrong credentials" (status 2
 * or an `error` object in the API's own JSON, with HTTP 200 or any 4xx but
 * 429; or HTTP 401), or the list answered 401 to a token that a
 * login had just given. Trying a wrong password again and again locks the
 * account: the app stops for a long, growing delay. A 401 to an older token
 * is not a refusal: the client logs in again, once.
 */
export const isRefused = (err) =>
  err?.code === CODES.REFUSED ||
  (err?.code === CODES.HTTP && err.status === 401 && err.account === true);

/**
 * A stop that only the user ends: refused credentials, or terms of use to
 * accept in the LibreLinkUp app (never accepted by the integration). Both
 * take the stop ladder of 1 h, 6 h, 24 h.
 */
export const isStop = (err) => isRefused(err) || err?.code === CODES.TERMS;
