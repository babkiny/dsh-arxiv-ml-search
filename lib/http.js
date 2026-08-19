/**
 * The one impure module: fetching a feed from arXiv.
 *
 * arXiv asks API clients to identify themselves and to leave about three
 * seconds between requests. Both are enforced here rather than at the call
 * sites, so no tool can accidentally hammer the service.
 *
 * `fetchImpl` and `now` are injectable so the tests never touch the network.
 *
 * @module dsh-arxiv-ml-search/lib/http
 */

/** arXiv's requested minimum gap between API calls, in milliseconds. */
export const MIN_INTERVAL_MS = 3000

/** How long a single request may take before it is aborted. */
export const DEFAULT_TIMEOUT_MS = 20000

const REPO = 'https://github.com/babkiny/dsh-arxiv-ml-search'

let lastRequestAt = 0
let queue = Promise.resolve()

/**
 * Build the User-Agent arXiv sees.
 * @param {string} [contact] - optional contact address for the operator.
 * @returns {string} User-Agent header value.
 */
export function userAgent(contact) {
  const suffix = contact ? '; ' + contact : ''
  return 'dsh-arxiv-ml-search/0.1 (+' + REPO + suffix + ')'
}

/**
 * Sleep, unless the wait is zero.
 * @param {number} ms - milliseconds.
 * @returns {Promise<void>} resolves after the wait.
 */
function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
}

/**
 * Take the next slot in the send queue.
 *
 * Comparing timestamps alone is not enough: concurrent callers all read the
 * same `lastRequestAt`, sleep the same amount and then fire together, which is
 * exactly the burst arXiv refuses. An agent issuing several searches at once —
 * each of which may walk a strategy ladder — makes that the common case, so
 * callers queue on a promise chain and every request waits for the one before.
 *
 * @param {number} interval - minimum gap in milliseconds.
 * @param {() => number} now - clock, injectable for tests.
 * @returns {Promise<void>} resolves when it is this caller's turn to send.
 */
function reserveSlot(interval, now) {
  const slot = queue.then(async () => {
    const elapsed = now() - lastRequestAt
    if (lastRequestAt && elapsed < interval) await sleep(interval - elapsed)
    lastRequestAt = now()
  })
  // A caller that throws must not break the chain for everyone behind it.
  queue = slot.catch(() => {})
  return slot
}

/**
 * Fetch an arXiv Atom feed with throttling, a timeout and one retry.
 * @param {string} url - request URL, from lib/query.js.
 * @param {object} [options] - transport options.
 * @param {typeof fetch} [options.fetchImpl] - fetch implementation.
 * @param {number} [options.timeoutMs] - per-attempt timeout.
 * @param {number} [options.minIntervalMs] - politeness interval.
 * @param {string} [options.contact] - contact address for the User-Agent.
 * @param {() => number} [options.now] - clock, injectable for tests.
 * @returns {Promise<string>} the raw feed body.
 */
export async function fetchFeed(url, options = {}) {
  const doFetch = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS
  const interval = Number.isFinite(Number(options.minIntervalMs)) ? Number(options.minIntervalMs) : MIN_INTERVAL_MS
  const now = options.now ?? Date.now
  const headers = { 'User-Agent': userAgent(options.contact), Accept: 'application/atom+xml' }

  let lastError = null
  for (let attempt = 0; attempt < 2; attempt++) {
    await reserveSlot(interval, now)
    try {
      const response = await doFetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
      if (response.ok) return await response.text()
      // 4xx means the query itself is wrong — retrying cannot help.
      if (response.status < 500) {
        throw new Error('arXiv rejected the request (HTTP ' + response.status + '): check the query syntax')
      }
      lastError = new Error('arXiv is unavailable (HTTP ' + response.status + ')')
    } catch (error) {
      if (error instanceof Error && /rejected the request/.test(error.message)) throw error
      lastError = error instanceof Error ? error : new Error(String(error))
    }
    if (attempt === 0) await sleep(1000)
  }
  throw new Error('arXiv request failed: ' + (lastError ? lastError.message : 'unknown error'))
}

/**
 * Reset the throttle clock. Tests only — production code has one process-wide
 * rate limiter on purpose.
 * @returns {void}
 */
export function resetThrottle() {
  lastRequestAt = 0
  queue = Promise.resolve()
}
