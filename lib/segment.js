/**
 * Text budgeting. Abstracts are cheap individually and expensive in bulk, so a
 * search result carries a truncated abstract and the agent pulls the full text
 * — or one segment of it — only for the papers it actually cares about.
 *
 * Pure and dependency-free; v2's full-text tool will reuse segmentText as is.
 *
 * @module dsh-arxiv-ml-search/lib/segment
 */

/** Default per-paper abstract budget inside a search result. */
export const DEFAULT_ABSTRACT_CHARS = 350

/** Default segment size when paging through a long text. Full abstracts fit
 * inside this, so segmentation only engages when the caller asks for less. */
export const DEFAULT_SEGMENT_CHARS = 4000

/**
 * Shorten text to a budget, cutting on a word boundary.
 * @param {string} text - source text.
 * @param {number} maxChars - budget in characters.
 * @returns {string} text at or under the budget, ellipsised when cut.
 */
export function truncate(text, maxChars) {
  const source = String(text ?? '')
  const limit = Math.max(1, Math.trunc(Number(maxChars) || DEFAULT_ABSTRACT_CHARS))
  if (source.length <= limit) return source
  const window = source.slice(0, limit)
  const lastSpace = window.lastIndexOf(' ')
  // Only respect the word boundary if it does not throw away most of the window.
  const cut = lastSpace > limit * 0.6 ? lastSpace : limit
  return source.slice(0, cut).trimEnd() + '…'
}

/**
 * Find where to end a segment that starts at `from`.
 * @param {string} text - full source text.
 * @param {number} from - start offset.
 * @param {number} size - target segment size.
 * @returns {number} end offset, exclusive.
 */
function boundary(text, from, size) {
  const hardEnd = Math.min(text.length, from + size)
  if (hardEnd >= text.length) return text.length
  const window = text.slice(from, hardEnd)
  const floor = Math.trunc(size * 0.5)
  // Prefer a paragraph break, then a sentence end, then any word boundary.
  const paragraph = window.lastIndexOf('\n\n')
  if (paragraph > floor) return from + paragraph + 2
  const sentence = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('? '),
    window.lastIndexOf('! '),
  )
  if (sentence > floor) return from + sentence + 2
  const space = window.lastIndexOf(' ')
  if (space > floor) return from + space + 1
  return hardEnd
}

/**
 * @typedef {object} Segment
 * @property {number} index - 1-based position of this segment.
 * @property {number} total - number of segments the text splits into.
 * @property {string} text - the segment body.
 */

/**
 * Split text into overlapping, budget-sized segments on natural boundaries.
 * @param {string} text - source text.
 * @param {object} [options] - segmentation options.
 * @param {number} [options.maxChars] - target segment size.
 * @param {number} [options.overlap] - characters of context repeated from the
 *   previous segment, so a sentence spanning the seam still reads whole.
 * @returns {Segment[]} segments in order; always at least one.
 */
export function segmentText(text, options = {}) {
  const source = String(text ?? '').trim()
  const size = Math.max(80, Math.trunc(Number(options.maxChars) || DEFAULT_SEGMENT_CHARS))
  const overlap = Math.min(Math.trunc(size / 4), Math.max(0, Math.trunc(Number(options.overlap) || 0)))
  if (!source) return [{ index: 1, total: 1, text: '' }]

  const bodies = []
  let from = 0
  while (from < source.length) {
    const end = boundary(source, from, size)
    bodies.push(source.slice(from, end).trim())
    if (end >= source.length) break
    // Step back for overlap, but never far enough to stall the loop.
    const next = Math.max(from + 1, end - overlap)
    from = next
  }
  const total = bodies.length
  return bodies.map((body, i) => ({ index: i + 1, total, text: body }))
}

/**
 * Pick one segment of a text, or the whole text when no segment is requested.
 * @param {string} text - source text.
 * @param {number} [segment] - 1-based segment number.
 * @param {number} [maxChars] - segment size.
 * @returns {{ text: string, segment: number, segments: number }} the chosen slice.
 */
export function selectSegment(text, segment, maxChars) {
  const segments = segmentText(text, { maxChars, overlap: 100 })
  // With no segment asked for, hand back the first one; `segments` tells the
  // agent whether there is more to page through.
  const wanted = segment === undefined || segment === null ? 1 : segment
  const index = Math.min(segments.length, Math.max(1, Math.trunc(Number(wanted) || 1)))
  return { text: segments[index - 1].text, segment: index, segments: segments.length }
}
