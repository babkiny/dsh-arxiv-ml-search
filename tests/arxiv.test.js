/**
 * End-to-end tests for the tool path — query, transport, parse, shape — with a
 * fake fetch so nothing touches the network.
 * @module dsh-arxiv-ml-search/tests/arxiv
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getPapers, renderDetails, renderSearch, search } from '../lib/arxiv.js'
import { formatAuthors, toSearchResult } from '../lib/format.js'
import { fetchFeed, resetThrottle, userAgent } from '../lib/http.js'
import { parseFeed } from '../lib/atom.js'

/**
 * Load a saved feed.
 * @param {string} fixture - fixture base name.
 * @returns {string} feed body.
 */
function feed(fixture) {
  return readFileSync(fileURLToPath(new URL('./fixtures/' + fixture + '.atom.xml', import.meta.url)), 'utf8')
}

/**
 * Build a fetch stand-in that always answers with the same feed and records
 * the URLs it was called with.
 * @param {string} body - response body.
 * @param {object} [init] - `{ status }` for the fake response.
 * @returns {{ (url: string): Promise<object>, calls: string[] }} fake fetch.
 */
function fakeFetch(body, init = {}) {
  const calls = []
  const impl = async (url) => {
    calls.push(url)
    const status = init.status ?? 200
    return { ok: status >= 200 && status < 300, status, text: async () => body }
  }
  impl.calls = calls
  return impl
}

/** Transport options that skip the politeness delay. */
const fast = (fetchImpl) => {
  resetThrottle()
  return { fetchImpl, minIntervalMs: 0 }
}

test('search shapes the feed into a result payload', async () => {
  const fetchImpl = fakeFetch(feed('search'))
  const result = await search({ query: 'chain of thought', categories: ['cs.LG'], limit: 5 }, fast(fetchImpl))
  assert.equal(result.returned, 5)
  assert.equal(result.offset, 0)
  assert.ok(result.total > 1000)
  assert.equal(result.query, 'all:"chain of thought" AND (cat:cs.LG)')
  assert.match(fetchImpl.calls[0], /^https:\/\/export\.arxiv\.org\/api\/query\?/)
  const paper = result.papers[0]
  assert.ok(paper.id && paper.title && paper.abs_url && paper.pdf_url)
  assert.equal(typeof paper.abstract_truncated, 'boolean')
})

test('search truncates abstracts to the requested budget', async () => {
  const result = await search({ query: 'x', abstract_chars: 120 }, fast(fakeFetch(feed('search'))))
  for (const paper of result.papers) {
    assert.ok(paper.abstract.length <= 121, 'abstract should respect the budget')
    assert.equal(paper.abstract_truncated, true)
    assert.ok(paper.abstract.endsWith('…'))
  }
})

test('a full abstract is not marked as truncated', async () => {
  const result = await search({ query: 'x', abstract_chars: 5000 }, fast(fakeFetch(feed('search'))))
  assert.equal(result.papers[0].abstract_truncated, false)
  assert.ok(!result.papers[0].abstract.endsWith('…'))
})

test('an empty feed produces an empty, well-formed payload', async () => {
  const result = await search({ query: 'nothing at all' }, fast(fakeFetch(feed('empty'))))
  assert.equal(result.total, 0)
  assert.deepEqual(result.papers, [])
  assert.match(renderSearch(result), /No arXiv papers matched/)
})

test('getPapers returns full abstracts and reports missing ids', async () => {
  const fetchImpl = fakeFetch(feed('idlist'))
  const result = await getPapers({ ids: ['1706.03762', '1412.6980', '9999.99999'] }, fast(fetchImpl))
  assert.equal(result.requested, 3)
  assert.equal(result.returned, 2)
  assert.deepEqual(result.missing, ['9999.99999'])
  assert.match(fetchImpl.calls[0], /id_list=1706\.03762%2C1412\.6980%2C9999\.99999/)
  const paper = result.papers[0]
  assert.equal(paper.id, '1706.03762v7')
  assert.equal(paper.segments_total, 1, 'a normal abstract comes back whole')
  assert.ok(paper.abstract.includes('Transformer'))
})

test('a versioned id is matched against its unversioned request', async () => {
  const result = await getPapers({ ids: ['1706.03762v7'] }, fast(fakeFetch(feed('idlist'))))
  assert.deepEqual(result.missing, [])
})

test('getPapers segments a long abstract on request', async () => {
  const first = await getPapers({ ids: ['1706.03762'], max_chars: 300 }, fast(fakeFetch(feed('idlist'))))
  assert.ok(first.papers[0].segments_total > 1)
  assert.equal(first.papers[0].segment, 1)
  const second = await getPapers({ ids: ['1706.03762'], max_chars: 300, segment: 2 }, fast(fakeFetch(feed('idlist'))))
  assert.equal(second.papers[0].segment, 2)
  assert.notEqual(second.papers[0].abstract, first.papers[0].abstract)
})

test('renderSearch lists papers compactly with paging context', async () => {
  const result = await search({ query: 'x', limit: 5 }, fast(fakeFetch(feed('search'))))
  const text = renderSearch(result)
  assert.match(text, /^\d+ matches \(showing 1-5\)/)
  assert.ok(text.includes(result.papers[0].id))
  assert.ok(text.includes(result.papers[0].title))
})

test('renderDetails marks which segment it is showing', async () => {
  const result = await getPapers({ ids: ['1706.03762'], max_chars: 300, segment: 2 }, fast(fakeFetch(feed('idlist'))))
  assert.match(renderDetails(result), /\[abstract segment 2\/\d+\]/)
})

test('long author lists are collapsed', () => {
  assert.equal(formatAuthors(['A', 'B']), 'A, B')
  assert.equal(formatAuthors(['A', 'B', 'C', 'D', 'E', 'F']), 'A, B, C, D et al. (6 authors)')
})

test('search records keep dates as calendar days', () => {
  const paper = parseFeed(feed('idlist')).papers[0]
  assert.equal(toSearchResult(paper).published, '2017-06-12')
})

test('a 5xx response is retried, a 4xx is not', async () => {
  let attempts = 0
  const flaky = async () => {
    attempts++
    if (attempts === 1) return { ok: false, status: 503, text: async () => '' }
    return { ok: true, status: 200, text: async () => feed('empty') }
  }
  resetThrottle()
  const body = await fetchFeed('https://example.invalid/q', { fetchImpl: flaky, minIntervalMs: 0 })
  assert.equal(attempts, 2)
  assert.ok(body.includes('<feed'))

  let badAttempts = 0
  const bad = async () => {
    badAttempts++
    return { ok: false, status: 400, text: async () => '' }
  }
  resetThrottle()
  await assert.rejects(
    () => fetchFeed('https://example.invalid/q', { fetchImpl: bad, minIntervalMs: 0 }),
    /check the query syntax/,
  )
  assert.equal(badAttempts, 1, 'a bad query must not be retried')
})

test('the User-Agent identifies the plugin and any contact', () => {
  assert.match(userAgent(), /^dsh-arxiv-ml-search\/0\.1 \(\+https:\/\/github\.com\//)
  assert.ok(userAgent('mail@example.com').includes('; mail@example.com'))
})

test('requests are spaced by the politeness interval', async () => {
  const fetchImpl = fakeFetch(feed('empty'))
  resetThrottle()
  const started = Date.now()
  await fetchFeed('https://example.invalid/1', { fetchImpl, minIntervalMs: 120 })
  await fetchFeed('https://example.invalid/2', { fetchImpl, minIntervalMs: 120 })
  assert.ok(Date.now() - started >= 110, 'second request should wait out the interval')
})
