/**
 * Orchestration: query -> fetch -> parse -> shape. Kept out of index.js so the
 * whole path is testable by injecting a fake fetch, with no harness in sight.
 *
 * @module dsh-arxiv-ml-search/lib/arxiv
 */

import { parseFeed } from './atom.js'
import { renderDetails, renderSearch, toDetail, toSearchResult } from './format.js'
import { fetchFeed } from './http.js'
import { buildIdUrl, buildSearchUrl, normaliseId } from './query.js'
import { DEFAULT_ABSTRACT_CHARS } from './segment.js'

/**
 * Run a search and shape the results.
 * @param {object} args - tool arguments; see lib/query.js buildSearchUrl.
 * @param {object} [options] - transport options plus `abstractChars`.
 * @returns {Promise<object>} search result payload.
 */
export async function search(args = {}, options = {}) {
  const url = buildSearchUrl(args)
  const feed = parseFeed(await fetchFeed(url, options))
  const abstractChars = Number(args.abstract_chars) || options.abstractChars || DEFAULT_ABSTRACT_CHARS
  return {
    total: feed.total,
    offset: feed.start,
    returned: feed.count,
    query: decodeURIComponent(new URL(url).searchParams.get('search_query') ?? ''),
    papers: feed.papers.map((paper) => toSearchResult(paper, abstractChars)),
  }
}

/**
 * Fetch specific papers by id.
 * @param {object} args - `ids`, and optional `segment` / `max_chars`.
 * @param {object} [options] - transport options.
 * @returns {Promise<object>} detail payload, including ids that returned nothing.
 */
export async function getPapers(args = {}, options = {}) {
  const requested = (Array.isArray(args.ids) ? args.ids : [args.ids]).map(normaliseId).filter(Boolean)
  const feed = parseFeed(await fetchFeed(buildIdUrl(requested), options))
  const papers = feed.papers
    // A withdrawn or mistyped id comes back as an entry with an error title
    // and no authors; drop those rather than presenting them as real papers.
    .filter((paper) => paper.id && paper.authors.length)
    .map((paper) => toDetail(paper, { segment: args.segment, maxChars: args.max_chars }))
  const found = new Set(papers.map((paper) => paper.id.replace(/v\d+$/, '')))
  return {
    requested: requested.length,
    returned: papers.length,
    missing: requested.filter((id) => !found.has(id.replace(/v\d+$/, ''))),
    papers,
  }
}

export { renderDetails, renderSearch }
