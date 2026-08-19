/**
 * Build arXiv API request URLs. Pure — the tests assert on strings, no network.
 *
 * arXiv query syntax reference: field prefixes ti/abs/au/cat/all, boolean
 * AND/OR/ANDNOT, parentheses for grouping, double quotes for phrases, and
 * submittedDate ranges written as [YYYYMMDDHHMM TO YYYYMMDDHHMM].
 *
 * @module dsh-arxiv-ml-search/lib/query
 */

export const API_URL = 'https://export.arxiv.org/api/query'

/** Categories that cover machine learning across arXiv's archives. */
export const ML_CATEGORIES = ['cs.LG', 'cs.AI', 'cs.CL', 'cs.CV', 'cs.NE', 'cs.RO', 'stat.ML']

/** Tool-facing sort names mapped to the API's sortBy values. */
export const SORT_FIELDS = {
  relevance: 'relevance',
  submitted: 'submittedDate',
  updated: 'lastUpdatedDate',
}

/** Tool-facing search scopes mapped to arXiv field prefixes. */
export const SEARCH_FIELDS = { all: 'all', title: 'ti', abstract: 'abs' }

/** Hard ceiling per request. The API allows far more; context budget does not. */
export const MAX_LIMIT = 50

const RAW_QUERY_MARKER = /\b(AND|OR|ANDNOT)\b|\b(?:ti|abs|au|cat|all|co|jr|rn|id):/

/**
 * Quote a term as a phrase when it contains whitespace.
 * @param {string} prefix - arXiv field prefix, e.g. 'abs'.
 * @param {string} term - user term.
 * @returns {string} one query clause.
 */
function clause(prefix, term) {
  // Stray double quotes would unbalance the phrase and the API 400s.
  const clean = term.replace(/"/g, ' ').replace(/\s+/g, ' ').trim()
  return /\s/.test(clean) ? prefix + ':"' + clean + '"' : prefix + ':' + clean
}

/**
 * Convert a YYYY-MM-DD date into the API's timestamp form.
 * @param {string} date - calendar date.
 * @param {string} edge - 'start' or 'end' of that day.
 * @returns {string} 12-digit timestamp.
 */
function stamp(date, edge) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date).trim())
  if (!match) throw new Error('date must be YYYY-MM-DD, got "' + date + '"')
  return match[1] + match[2] + match[3] + (edge === 'start' ? '0000' : '2359')
}

/**
 * Clamp a limit into the supported range.
 * @param {number} [limit] - requested page size.
 * @returns {number} clamped page size.
 */
function clampLimit(limit) {
  const value = Number.isFinite(Number(limit)) ? Math.trunc(Number(limit)) : 10
  return Math.min(MAX_LIMIT, Math.max(1, value))
}

/**
 * Assemble the `search_query` expression.
 * @param {object} args - see buildSearchUrl.
 * @returns {string} the expression, unencoded.
 */
export function buildSearchQuery(args = {}) {
  const groups = []
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (query) {
    // A caller who already wrote arXiv syntax gets it passed through verbatim;
    // plain text is wrapped into a single field clause.
    if (RAW_QUERY_MARKER.test(query)) groups.push('(' + query + ')')
    else groups.push(clause(SEARCH_FIELDS[args.field] ?? 'all', query))
  }

  const authors = (args.authors ?? []).filter(Boolean)
  if (authors.length) groups.push('(' + authors.map((a) => clause('au', a)).join(' AND ') + ')')

  const categories = (args.categories ?? []).filter(Boolean)
  if (categories.length) groups.push('(' + categories.map((c) => 'cat:' + c.trim()).join(' OR ') + ')')

  if (args.from || args.to) {
    const from = args.from ? stamp(args.from, 'start') : '199101010000'
    const to = args.to ? stamp(args.to, 'end') : '299912312359'
    groups.push('submittedDate:[' + from + ' TO ' + to + ']')
  }

  if (!groups.length) throw new Error('a search needs at least a query, an author, a category or a date range')
  return groups.join(' AND ')
}

/**
 * Build the full search request URL.
 * @param {object} args - search arguments.
 * @param {string} [args.query] - free text, or raw arXiv syntax.
 * @param {string} [args.field] - 'all' | 'title' | 'abstract'.
 * @param {string[]} [args.authors] - author names, ANDed together.
 * @param {string[]} [args.categories] - arXiv categories, ORed together.
 * @param {string} [args.from] - earliest submission date, YYYY-MM-DD.
 * @param {string} [args.to] - latest submission date, YYYY-MM-DD.
 * @param {string} [args.sort] - 'relevance' | 'submitted' | 'updated'.
 * @param {string} [args.order] - 'descending' | 'ascending'.
 * @param {number} [args.limit] - page size, clamped to 1..50.
 * @param {number} [args.offset] - result offset for paging.
 * @returns {string} request URL.
 */
export function buildSearchUrl(args = {}) {
  const params = new URLSearchParams()
  params.set('search_query', buildSearchQuery(args))
  params.set('start', String(Math.max(0, Math.trunc(Number(args.offset) || 0))))
  params.set('max_results', String(clampLimit(args.limit)))
  params.set('sortBy', SORT_FIELDS[args.sort] ?? 'relevance')
  params.set('sortOrder', args.order === 'ascending' ? 'ascending' : 'descending')
  return API_URL + '?' + params.toString()
}

/**
 * Strip the decorations people paste around an arXiv id.
 * @param {string} id - raw id, URL or "arXiv:1706.03762v7" form.
 * @returns {string} bare id, version preserved when given.
 */
export function normaliseId(id) {
  return String(id)
    .trim()
    .replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//i, '')
    .replace(/\.pdf$/i, '')
    .replace(/^arxiv:/i, '')
}

/**
 * Build a metadata request for specific papers.
 * @param {string[]} ids - arXiv ids in any accepted form.
 * @returns {string} request URL.
 */
export function buildIdUrl(ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).map(normaliseId).filter(Boolean)
  if (!list.length) throw new Error('no arXiv ids given')
  if (list.length > MAX_LIMIT) throw new Error('at most ' + MAX_LIMIT + ' ids per request, got ' + list.length)
  const params = new URLSearchParams()
  params.set('id_list', list.join(','))
  params.set('max_results', String(list.length))
  return API_URL + '?' + params.toString()
}
