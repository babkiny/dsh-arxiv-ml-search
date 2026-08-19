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
 * Resolve a tool-facing name against a fixed mapping.
 *
 * The tool schema's `enum` already rejects anything else, but these builders are
 * exported and called directly by tests, scripts and any other consumer, and a
 * bare index would hand back inherited members for names like "__proto__".
 *
 * @param {Record<string, string>} table - the mapping to read.
 * @param {string} [name] - the caller-supplied name.
 * @param {string} fallback - value for an absent or unknown name.
 * @returns {string} the mapped value.
 */
function mapped(table, name, fallback) {
  return typeof name === 'string' && Object.hasOwn(table, name) ? table[name] : fallback
}

/**
 * How a plain-text query is turned into an arXiv expression. Ordered from
 * most precise to most forgiving; `lib/arxiv.js` walks them in this order.
 *
 * - `phrase`  — the whole query as one exact phrase. Precise, and empty far
 *   too often: a natural-language question matches no paper verbatim.
 * - `terms`   — AND of the content words, function words dropped.
 * - `keywords`— AND of the topical words only, generic research verbs and
 *   meta-nouns dropped too.
 */
export const STRATEGIES = ['phrase', 'terms', 'keywords']

/** Function words that carry no topical signal in any query. */
const STOPWORDS = new Set([
  'a', 'about', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been', 'by', 'can', 'could', 'did',
  'do', 'does', 'for', 'from', 'had', 'has', 'have', 'how', 'i', 'if', 'in', 'into', 'is', 'it',
  'its', 'may', 'might', 'not', 'of', 'on', 'or', 'over', 'should', 'so', 'some', 'than', 'that',
  'the', 'their', 'then', 'there', 'these', 'this', 'those', 'to', 'under', 'was', 'we', 'were',
  'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'would', 'you',
])

/**
 * Words that describe the act of research rather than its subject. Dropped
 * only on the last rung. Deliberately conservative: ML-meaningful words such
 * as "model", "training" or "data" must never appear here.
 */
const WEAK_WORDS = new Set([
  'article', 'articles', 'best', 'cause', 'caused', 'causes', 'claim', 'claims', 'demonstrate',
  'demonstrates', 'evidence', 'find', 'finding', 'findings', 'finds', 'found', 'help', 'helps',
  'hurt', 'hurts', 'improve', 'improves', 'latest', 'new', 'paper', 'papers', 'prove', 'proves',
  'recent', 'report', 'reports', 'research', 'result', 'results', 'show', 'showed', 'shows',
  'studies', 'study', 'suggest', 'suggests', 'work', 'works', 'worse', 'worsen', 'worsens',
])

/**
 * Split a plain-text query into searchable words.
 * @param {string} text - the raw query.
 * @returns {string[]} lowercase-comparable words, punctuation stripped.
 */
function words(text) {
  return text.replace(/["'()]/g, ' ').split(/[\s,;:.?!]+/).filter(Boolean)
}

/**
 * Reduce a query to the words a given strategy keeps.
 * @param {string} text - the raw query.
 * @param {string} strategy - 'terms' or 'keywords'.
 * @returns {string[]} retained words, original casing preserved.
 */
export function significantWords(text, strategy) {
  const drop = strategy === 'keywords'
    ? (word) => STOPWORDS.has(word) || WEAK_WORDS.has(word)
    : (word) => STOPWORDS.has(word)
  const kept = words(text).filter((word) => !drop(word.toLowerCase()))
  // Never reduce a query to nothing: a query made entirely of dropped words
  // still has to search for something.
  return kept.length ? kept : words(text)
}

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
 * @param {string} [strategy] - one of {@link STRATEGIES}; ignored when the
 *   query is already raw arXiv syntax.
 * @returns {string} the expression, unencoded.
 */
export function buildSearchQuery(args = {}, strategy = 'phrase') {
  const groups = []
  const field = mapped(SEARCH_FIELDS, args.field, 'all')
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (query) {
    // A caller who already wrote arXiv syntax gets it passed through verbatim;
    // plain text is shaped by the strategy.
    if (RAW_QUERY_MARKER.test(query)) {
      groups.push('(' + query + ')')
    } else if (strategy === 'phrase') {
      groups.push(clause(field, query))
    } else {
      const kept = significantWords(query, strategy).map((word) => clause(field, word))
      groups.push(kept.length > 1 ? '(' + kept.join(' AND ') + ')' : kept[0])
    }
  }

  // Synonyms for one concept: papers name the same idea differently, so ORing
  // the phrasings in a single request beats hoping one guess lands.
  const anyOf = (args.any_of ?? []).filter(Boolean)
  if (anyOf.length) groups.push('(' + anyOf.map((term) => clause(field, term)).join(' OR ') + ')')

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
 * Decide which strategies to try, in order, for one set of arguments.
 *
 * A `match` other than 'auto' pins a single strategy — the caller asked for
 * exactly that. 'auto' walks from precise to forgiving, skipping rungs that
 * would send an expression identical to one already planned (a single-word
 * query is the same string under every strategy, so it is tried once).
 *
 * @param {object} args - search arguments.
 * @returns {Array<{ strategy: string, query: string }>} the ladder to walk.
 */
export function planStrategies(args = {}) {
  const requested = args.match && args.match !== 'auto' ? [args.match] : STRATEGIES
  if (!STRATEGIES.includes(requested[0])) throw new Error('match must be auto, ' + STRATEGIES.join(', '))
  const plan = []
  const seen = new Set()
  for (const strategy of requested) {
    const query = buildSearchQuery(args, strategy)
    if (seen.has(query)) continue
    seen.add(query)
    plan.push({ strategy, query })
  }
  return plan
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
export function buildSearchUrl(args = {}, strategy = 'phrase') {
  const params = new URLSearchParams()
  params.set('search_query', buildSearchQuery(args, strategy))
  params.set('start', String(Math.max(0, Math.trunc(Number(args.offset) || 0))))
  params.set('max_results', String(clampLimit(args.limit)))
  params.set('sortBy', mapped(SORT_FIELDS, args.sort, 'relevance'))
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
