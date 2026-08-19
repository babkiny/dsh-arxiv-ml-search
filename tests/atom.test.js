/**
 * Parser tests, run against real captured feeds plus a handcrafted feed for the
 * edge cases arXiv rarely emits.
 * @module dsh-arxiv-ml-search/tests/atom
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { decodeXml, parseFeed } from '../lib/atom.js'

/**
 * Load a saved feed.
 * @param {string} fixture - fixture base name.
 * @returns {string} feed body.
 */
function feed(fixture) {
  return readFileSync(fileURLToPath(new URL('./fixtures/' + fixture + '.atom.xml', import.meta.url)), 'utf8')
}

test('parses a real search feed', () => {
  const result = parseFeed(feed('search'))
  assert.equal(result.count, 5)
  assert.equal(result.start, 0)
  assert.ok(result.total > 1000, 'totalResults should be read from opensearch')
  const first = result.papers[0]
  assert.match(first.id, /^\d{4}\.\d{4,5}v\d+$/)
  assert.equal(first.baseId, first.id.replace(/v\d+$/, ''))
  assert.ok(first.title.length > 0)
  assert.ok(first.authors.length > 0)
  assert.ok(first.categories.includes('cs.LG') || first.categories.includes('cs.AI'))
})

test('reads the pdf link by title, not by rel', () => {
  const paper = parseFeed(feed('idlist')).papers[0]
  assert.equal(paper.id, '1706.03762v7')
  assert.equal(paper.title, 'Attention Is All You Need')
  assert.equal(paper.authors[0], 'Ashish Vaswani')
  // rel="related" on the pdf, rel="alternate" on the abs page.
  assert.match(paper.pdfUrl, /\/pdf\/1706\.03762v7$/)
  assert.match(paper.absUrl, /\/abs\/1706\.03762v7$/)
})

test('an empty feed parses to zero papers, not an error', () => {
  const result = parseFeed(feed('empty'))
  assert.equal(result.total, 0)
  assert.equal(result.count, 0)
  assert.deepEqual(result.papers, [])
})

test('collapses wrapped titles and abstracts', () => {
  const paper = parseFeed(feed('rich')).papers[0]
  assert.equal(paper.title, 'A Pre-2007 Identifier & A Title Wrapped Across Lines')
  assert.ok(!paper.summary.includes('\n'), 'abstract must not keep hard newlines')
  assert.ok(paper.summary.startsWith('This abstract is wrapped'))
  assert.ok(paper.summary.includes('<tag>'), 'entities should be decoded')
})

test('keeps the archive slash in pre-2007 ids', () => {
  const paper = parseFeed(feed('rich')).papers[0]
  assert.equal(paper.id, 'cs/0701001v1')
  assert.equal(paper.baseId, 'cs/0701001')
})

test('reads doi, journal ref and every author name', () => {
  const paper = parseFeed(feed('rich')).papers[0]
  assert.equal(paper.doi, '10.1000/example.doi')
  assert.equal(paper.journalRef, 'Journal of Examples 12 (2007) 34-56')
  assert.equal(paper.comment, '8 pages')
  assert.equal(paper.authors.length, 5)
  // An <arxiv:affiliation> sibling must not be mistaken for a name.
  assert.deepEqual(paper.authors.slice(0, 2), ['Ada Lovelace', 'Grace Hopper'])
})

test('missing optional fields come back empty, and links are synthesised', () => {
  const paper = parseFeed(feed('rich')).papers[1]
  assert.equal(paper.comment, '')
  assert.equal(paper.doi, '')
  assert.equal(paper.journalRef, '')
  assert.equal(paper.pdfUrl, 'https://arxiv.org/pdf/2101.00001v1')
})

test('decodeXml handles named and numeric entities', () => {
  assert.equal(decodeXml('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;'), 'a & b <c> "d" \'e\'')
  assert.equal(decodeXml('&#8212; &#x2014;'), '— —')
  assert.equal(decodeXml('&unknown; stays'), '&unknown; stays')
})

test('rejects a body that is not a feed', () => {
  assert.throws(() => parseFeed('<html>503 Service Unavailable</html>'), /not an Atom feed/)
})
