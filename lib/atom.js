/**
 * Minimal Atom parser for the arXiv API. No dependencies: the feed shape is
 * narrow and stable, so a general XML parser would be more surface than value.
 *
 * Everything here is pure — feed text in, plain records out — so the tests run
 * offline against saved fixtures.
 *
 * @module dsh-arxiv-ml-search/lib/atom
 */

/**
 * @typedef {object} Paper
 * @property {string} id - versioned arXiv id, e.g. "1706.03762v7".
 * @property {string} baseId - id without the version, e.g. "1706.03762".
 * @property {string} title - whitespace-normalised title.
 * @property {string} summary - whitespace-normalised abstract.
 * @property {string[]} authors - author names in feed order.
 * @property {string[]} categories - all arXiv categories on the entry.
 * @property {string} primaryCategory - the primary category term.
 * @property {string} published - ISO timestamp of the v1 submission.
 * @property {string} updated - ISO timestamp of the latest version.
 * @property {string} comment - author comment (pages, venue, code links).
 * @property {string} doi - DOI when the authors registered one.
 * @property {string} journalRef - journal reference when published.
 * @property {string} absUrl - abstract page URL.
 * @property {string} pdfUrl - PDF URL.
 */

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/**
 * Decode the XML entities arXiv actually emits.
 * @param {string} text - raw XML text node.
 * @returns {string} decoded text.
 */
export function decodeXml(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
    if (body.charAt(0) === '#') {
      const hex = body.charAt(1) === 'x' || body.charAt(1) === 'X'
      const code = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      // Anything past the last code point makes fromCodePoint throw, which would
      // turn one malformed character reference into a failed tool call.
      const valid = Number.isFinite(code) && code > 0 && code <= 0x10ffff
      return valid ? String.fromCodePoint(code) : match
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : match
  })
}

/**
 * Collapse the line wrapping arXiv applies to titles and abstracts. Without
 * this the model receives hard newlines and ragged indentation mid-sentence.
 * @param {string} text - decoded text.
 * @returns {string} single-spaced text.
 */
function collapse(text) {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Build the matcher for one element, namespace prefix included.
 * @param {string} tag - element name, e.g. 'arxiv:comment'.
 * @returns {RegExp} element matcher with the inner text as group 1.
 */
function elementPattern(tag) {
  return new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>')
}

/**
 * Read the text of the first matching element.
 * @param {string} xml - fragment to search.
 * @param {string} tag - element name.
 * @returns {string} decoded, whitespace-collapsed text ('' when absent).
 */
function tagText(xml, tag) {
  const match = elementPattern(tag).exec(xml)
  return match ? collapse(decodeXml(match[1])) : ''
}

/**
 * Read an attribute off a single raw tag.
 * @param {string} tag - raw tag text, e.g. '<link href="..." title="pdf"/>'.
 * @param {string} name - attribute name.
 * @returns {string} decoded attribute value ('' when absent).
 */
function attr(tag, name) {
  const match = new RegExp(name + '="([^"]*)"').exec(tag)
  return match ? decodeXml(match[1]) : ''
}

/**
 * Turn one <entry> fragment into a Paper.
 * @param {string} entry - entry fragment without the surrounding tags.
 * @returns {Paper} parsed record.
 */
function parseEntry(entry) {
  // Ids look like http://arxiv.org/abs/1706.03762v7 — and pre-2007 ones like
  // http://arxiv.org/abs/cs/0701001v1, which keep an archive slash.
  const id = tagText(entry, 'id').replace(/^https?:\/\/arxiv\.org\/abs\//, '')
  const linkTags = [...entry.matchAll(/<link\b[^>]*>/g)].map((match) => match[0])
  // The PDF link is rel="related" title="pdf"; rel="alternate" is the abs page.
  const pdfTag = linkTags.find((tag) => attr(tag, 'title') === 'pdf')
  const absTag = linkTags.find((tag) => attr(tag, 'rel') === 'alternate')
  const primary = /<arxiv:primary_category\b[^>]*>/.exec(entry)
  const authors = []
  for (const block of entry.matchAll(/<author>([\s\S]*?)<\/author>/g)) {
    const name = tagText(block[1], 'name')
    if (name) authors.push(name)
  }
  return {
    id,
    baseId: id.replace(/v\d+$/, ''),
    title: tagText(entry, 'title'),
    summary: tagText(entry, 'summary'),
    authors,
    categories: [...entry.matchAll(/<category\b[^>]*>/g)].map((match) => attr(match[0], 'term')).filter(Boolean),
    primaryCategory: primary ? attr(primary[0], 'term') : '',
    published: tagText(entry, 'published'),
    updated: tagText(entry, 'updated'),
    comment: tagText(entry, 'arxiv:comment'),
    doi: tagText(entry, 'arxiv:doi'),
    journalRef: tagText(entry, 'arxiv:journal_ref'),
    absUrl: absTag ? attr(absTag, 'href') : (id ? 'https://arxiv.org/abs/' + id : ''),
    pdfUrl: pdfTag ? attr(pdfTag, 'href') : (id ? 'https://arxiv.org/pdf/' + id : ''),
  }
}

/**
 * Parse a full arXiv Atom feed.
 * @param {string} xml - the response body.
 * @returns {{ total: number, start: number, count: number, papers: Paper[] }} feed contents.
 */
export function parseFeed(xml) {
  if (typeof xml !== 'string' || !xml.includes('<feed')) {
    throw new Error('arXiv returned a body that is not an Atom feed')
  }
  const papers = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => parseEntry(match[1]))
  const number = (tag) => {
    const value = Number(tagText(xml, tag))
    return Number.isFinite(value) ? value : 0
  }
  return {
    total: number('opensearch:totalResults'),
    start: number('opensearch:startIndex'),
    count: papers.length,
    papers,
  }
}
