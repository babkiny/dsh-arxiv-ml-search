#!/usr/bin/env node
/**
 * Live check against the real arXiv API — the one thing the unit tests
 * deliberately do not do. Run it after touching lib/query.js or lib/atom.js,
 * and whenever you want to confirm the API still answers the way we expect.
 *
 *   node scripts/smoke.mjs
 *   node scripts/smoke.mjs "reward hacking"
 *   node scripts/smoke.mjs --refresh-fixtures
 *
 * @module dsh-arxiv-ml-search/scripts/smoke
 */

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getPapers, search } from '../lib/arxiv.js'
import { fetchFeed } from '../lib/http.js'
import { buildIdUrl, buildSearchUrl } from '../lib/query.js'

const FIXTURES = fileURLToPath(new URL('../tests/fixtures/', import.meta.url))

/**
 * Re-capture the saved feeds the unit tests run against.
 * @returns {Promise<void>} resolves when every fixture is written.
 */
async function refreshFixtures() {
  const targets = [
    ['search.atom.xml', buildSearchUrl({
      query: 'chain of thought',
      field: 'abstract',
      categories: ['cs.LG', 'cs.AI'],
      sort: 'submitted',
      limit: 5,
    })],
    ['idlist.atom.xml', buildIdUrl(['1706.03762', '1412.6980'])],
    ['empty.atom.xml', buildSearchUrl({ query: 'zzzz nonexistent qqq topic' })],
  ]
  for (const [file, url] of targets) {
    const body = await fetchFeed(url)
    writeFileSync(FIXTURES + file, body)
    console.log('wrote ' + file + ' (' + body.length + ' bytes)')
  }
  console.log('\nrich.atom.xml is handcrafted — do not overwrite it.')
}

/**
 * Run one search and one fetch, printing what the agent would see.
 * @param {string} query - search terms.
 * @returns {Promise<void>} resolves when both calls have printed.
 */
async function smoke(query) {
  const found = await search({ query, field: 'abstract', ml_only: true, categories: [], limit: 3, sort: 'submitted' })
  console.log('query:   ' + found.query)
  console.log('matches: ' + found.total + ', showing ' + found.returned + '\n')
  for (const paper of found.papers) {
    console.log(paper.id + '  ' + paper.title)
    console.log('  ' + paper.categories + ' · ' + paper.published + ' · ' + paper.authors)
    console.log('  ' + paper.abstract + '\n')
  }

  if (!found.papers.length) {
    console.log('no results, skipping the arxiv_get leg')
    return
  }
  const detail = await getPapers({ ids: [found.papers[0].id], max_chars: 400 })
  const paper = detail.papers[0]
  console.log('--- arxiv_get ' + paper.id + ' ---')
  console.log('abstract segment ' + paper.segment + '/' + paper.segments_total + ':')
  console.log(paper.abstract)
}

const args = process.argv.slice(2)
if (args.includes('--refresh-fixtures')) {
  await refreshFixtures()
} else {
  await smoke(args.filter((a) => !a.startsWith('--')).join(' ') || 'chain of thought')
}
