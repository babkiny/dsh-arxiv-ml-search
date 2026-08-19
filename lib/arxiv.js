/**
 * Orchestration: query -> fetch -> parse -> shape. Kept out of index.js so the
 * whole path is testable by injecting a fake fetch, with no harness in sight.
 *
 * @module dsh-arxiv-ml-search/lib/arxiv
 */

import { parseFeed } from './atom.js'
import { renderDetails, renderSearch, toDetail, toSearchResult } from './format.js'
import { fetchFeed } from './http.js'
import { buildIdUrl, buildSearchUrl, normaliseId, planStrategies } from './query.js'
import { DEFAULT_ABSTRACT_CHARS } from './segment.js'

/**
 * Run a search and shape the results.
 *
 * Walks the strategy ladder from `planStrategies`: an exact phrase first, then
 * progressively more forgiving word matching, stopping at the first rung that
 * finds anything. Only a miss costs an extra request, and the payload reports
 * which rung answered so the agent can say whether the match was exact.
 *
 * @param {object} args - tool arguments; see lib/query.js buildSearchUrl.
 * @param {object} [options] - transport options plus `abstractChars`.
 * @returns {Promise<object>} search result payload.
 */
export async function search(args = {}, options = {}) {
  const plan = planStrategies(args)
  const abstractChars = Number(args.abstract_chars) || options.abstractChars || DEFAULT_ABSTRACT_CHARS

  let last = null
  for (const [index, rung] of plan.entries()) {
    const url = buildSearchUrl(args, rung.strategy)
    const feed = parseFeed(await fetchFeed(url, options))
    last = {
      total: feed.total,
      offset: feed.start,
      returned: feed.count,
      query: rung.query,
      strategy: rung.strategy,
      relaxed: index > 0,
      papers: feed.papers.map((paper) => toSearchResult(paper, abstractChars)),
    }
    if (feed.count > 0) return last
  }
  // Every rung came back empty; report the most forgiving attempt, since that
  // is the one whose emptiness actually means something.
  return last
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
