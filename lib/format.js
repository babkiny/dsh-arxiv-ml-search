/**
 * Shape parsed papers into the records the tools return, and into the compact
 * text the harness shows in chat. Pure, so the exact output is unit-tested.
 *
 * @module dsh-arxiv-ml-search/lib/format
 */

import { DEFAULT_ABSTRACT_CHARS, selectSegment, truncate } from './segment.js'

/** How many author names to keep before collapsing the rest. */
const AUTHOR_LIMIT = 4

/**
 * Render an author list without letting a 200-author paper dominate the output.
 * @param {string[]} authors - author names in feed order.
 * @returns {string} display string.
 */
export function formatAuthors(authors) {
  const list = authors ?? []
  if (list.length <= AUTHOR_LIMIT) return list.join(', ')
  return list.slice(0, AUTHOR_LIMIT).join(', ') + ' et al. (' + list.length + ' authors)'
}

/**
 * Keep the calendar date; the time of day never matters here.
 * @param {string} timestamp - ISO timestamp from the feed.
 * @returns {string} YYYY-MM-DD.
 */
export function formatDate(timestamp) {
  return String(timestamp ?? '').slice(0, 10)
}

/**
 * Build one search-result record: enough to judge relevance, not enough to
 * flood the context.
 * @param {import('./atom.js').Paper} paper - parsed paper.
 * @param {number} [abstractChars] - abstract budget.
 * @returns {object} search record.
 */
export function toSearchResult(paper, abstractChars = DEFAULT_ABSTRACT_CHARS) {
  return {
    id: paper.id,
    title: paper.title,
    authors: formatAuthors(paper.authors),
    categories: paper.categories.join(', '),
    published: formatDate(paper.published),
    updated: formatDate(paper.updated),
    abs_url: paper.absUrl,
    pdf_url: paper.pdfUrl,
    abstract: truncate(paper.summary, abstractChars),
    abstract_truncated: paper.summary.length > abstractChars,
  }
}

/**
 * Build one detail record, optionally sliced into a segment.
 * @param {import('./atom.js').Paper} paper - parsed paper.
 * @param {object} [options] - slicing options.
 * @param {number} [options.segment] - 1-based segment to return.
 * @param {number} [options.maxChars] - segment size.
 * @returns {object} detail record.
 */
export function toDetail(paper, options = {}) {
  const slice = selectSegment(paper.summary, options.segment, options.maxChars)
  return {
    id: paper.id,
    title: paper.title,
    authors: formatAuthors(paper.authors),
    categories: paper.categories.join(', '),
    primary_category: paper.primaryCategory,
    published: formatDate(paper.published),
    updated: formatDate(paper.updated),
    abs_url: paper.absUrl,
    pdf_url: paper.pdfUrl,
    comment: paper.comment,
    doi: paper.doi,
    journal_ref: paper.journalRef,
    abstract: slice.text,
    segment: slice.segment,
    segments_total: slice.segments,
  }
}

/**
 * Compact chat rendering for a result list.
 * @param {object} result - the arxiv_search return value.
 * @returns {string} text block.
 */
export function renderSearch(result) {
  if (!result.papers.length) {
    return 'No arXiv papers matched, down to loose word matching.\nTried: ' + result.query
      + '\nUse any_of with alternative phrasings, or drop a filter.'
  }
  const lines = result.papers.map((paper, i) => {
    const n = result.offset + i + 1
    return n + '. ' + paper.id + ' — ' + paper.title
      + '\n   ' + paper.categories + ' · ' + paper.published + ' · ' + paper.authors
  })
  const shown = result.offset + result.papers.length
  const more = result.total > shown ? ' (showing ' + (result.offset + 1) + '-' + shown + ')' : ''
  // A relaxed match is a weaker claim than an exact one; say so on the surface.
  const note = result.relaxed ? '\nExact phrase found nothing; matched on ' + result.strategy + ': ' + result.query : ''
  return result.total + ' matches' + more + note + '\n' + lines.join('\n')
}

/**
 * Compact chat rendering for fetched papers.
 * @param {object} result - the arxiv_get return value.
 * @returns {string} text block.
 */
export function renderDetails(result) {
  if (!result.papers.length) return 'No arXiv paper found for those ids.'
  return result.papers.map((paper) => {
    const part = paper.segments_total > 1
      ? ' [abstract segment ' + paper.segment + '/' + paper.segments_total + ']'
      : ''
    return paper.id + ' — ' + paper.title + part
      + '\n' + paper.authors + ' · ' + paper.categories + ' · ' + paper.published
      + (paper.journal_ref ? '\n' + paper.journal_ref : '')
      + '\n\n' + paper.abstract
  }).join('\n\n---\n\n')
}
