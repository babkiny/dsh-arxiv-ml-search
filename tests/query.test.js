/**
 * Query-building tests. The API is unforgiving about syntax, so the expression
 * is asserted literally rather than loosely matched.
 * @module dsh-arxiv-ml-search/tests/query
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildIdUrl, buildSearchQuery, buildSearchUrl, normaliseId } from '../lib/query.js'

/**
 * Read back the decoded search_query of a built URL.
 * @param {string} url - built URL.
 * @returns {string} the search_query parameter.
 */
function queryOf(url) {
  return new URL(url).searchParams.get('search_query')
}

test('plain multi-word text becomes a phrase clause', () => {
  assert.equal(buildSearchQuery({ query: 'chain of thought' }), 'all:"chain of thought"')
  assert.equal(buildSearchQuery({ query: 'transformers' }), 'all:transformers')
})

test('the field option picks the arXiv prefix', () => {
  assert.equal(buildSearchQuery({ query: 'scaling laws', field: 'abstract' }), 'abs:"scaling laws"')
  assert.equal(buildSearchQuery({ query: 'scaling laws', field: 'title' }), 'ti:"scaling laws"')
})

test('raw arXiv syntax is passed through untouched', () => {
  const raw = 'abs:"reward hacking" ANDNOT cat:cs.CV'
  assert.equal(buildSearchQuery({ query: raw }), '(' + raw + ')')
})

test('categories are ORed, authors are ANDed', () => {
  const expression = buildSearchQuery({
    query: 'rlhf',
    authors: ['Jane Doe', 'Smith'],
    categories: ['cs.LG', 'stat.ML'],
  })
  assert.equal(expression, 'all:rlhf AND (au:"Jane Doe" AND au:Smith) AND (cat:cs.LG OR cat:stat.ML)')
})

test('a date range becomes a submittedDate window', () => {
  const expression = buildSearchQuery({ query: 'x', from: '2024-01-01', to: '2024-12-31' })
  assert.equal(expression, 'all:x AND submittedDate:[202401010000 TO 202412312359]')
})

test('an open-ended range still produces a valid window', () => {
  assert.match(buildSearchQuery({ query: 'x', from: '2025-06-01' }), /\[202506010000 TO 299912312359\]$/)
  assert.match(buildSearchQuery({ query: 'x', to: '2025-06-01' }), /\[199101010000 TO 202506012359\]$/)
})

test('a malformed date is rejected with a usable message', () => {
  assert.throws(() => buildSearchQuery({ query: 'x', from: '01/06/2025' }), /YYYY-MM-DD/)
})

test('an empty search is rejected', () => {
  assert.throws(() => buildSearchQuery({}), /at least a query/)
})

test('stray quotes cannot unbalance the phrase', () => {
  assert.equal(buildSearchQuery({ query: 'a "weird" claim' }), 'all:"a weird claim"')
})

test('limit is clamped and paging parameters are set', () => {
  assert.equal(new URL(buildSearchUrl({ query: 'x', limit: 500 })).searchParams.get('max_results'), '50')
  assert.equal(new URL(buildSearchUrl({ query: 'x', limit: 0 })).searchParams.get('max_results'), '1')
  assert.equal(new URL(buildSearchUrl({ query: 'x' })).searchParams.get('max_results'), '10')
  assert.equal(new URL(buildSearchUrl({ query: 'x', offset: -5 })).searchParams.get('start'), '0')
})

test('sort names map onto the API values', () => {
  const sortOf = (sort) => new URL(buildSearchUrl({ query: 'x', sort })).searchParams.get('sortBy')
  assert.equal(sortOf('submitted'), 'submittedDate')
  assert.equal(sortOf('updated'), 'lastUpdatedDate')
  assert.equal(sortOf(undefined), 'relevance')
  assert.equal(new URL(buildSearchUrl({ query: 'x', order: 'ascending' })).searchParams.get('sortOrder'), 'ascending')
})

test('the built URL round-trips through URL decoding', () => {
  assert.equal(queryOf(buildSearchUrl({ query: 'chain of thought', categories: ['cs.LG'] })),
    'all:"chain of thought" AND (cat:cs.LG)')
})

test('ids are normalised from URLs and prefixes', () => {
  assert.equal(normaliseId('https://arxiv.org/abs/1706.03762v7'), '1706.03762v7')
  assert.equal(normaliseId('https://arxiv.org/pdf/1706.03762.pdf'), '1706.03762')
  assert.equal(normaliseId('arXiv:2101.00001'), '2101.00001')
  assert.equal(normaliseId('  cs/0701001 '), 'cs/0701001')
})

test('id requests carry the whole list and size themselves', () => {
  const url = buildIdUrl(['1706.03762', 'https://arxiv.org/abs/1412.6980v9'])
  const params = new URL(url).searchParams
  assert.equal(params.get('id_list'), '1706.03762,1412.6980v9')
  assert.equal(params.get('max_results'), '2')
  assert.equal(params.get('search_query'), null)
})

test('id requests reject empty and oversized lists', () => {
  assert.throws(() => buildIdUrl([]), /no arXiv ids/)
  assert.throws(() => buildIdUrl(new Array(51).fill('1706.03762')), /at most 50/)
})
