/**
 * dsh-arxiv-ml-search — search arXiv for machine-learning papers and check
 * claims against real abstracts instead of model memory.
 *
 * Host half only: plain ESM, no build step. All the deterministic work lives in
 * lib/ so it is unit-tested without the harness; this file just wires services.
 *
 * @module dsh-arxiv-ml-search
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { getPapers, renderDetails, renderSearch, search } from './lib/arxiv.js'
import { ML_CATEGORIES } from './lib/query.js'
import { DEFAULT_ABSTRACT_CHARS } from './lib/segment.js'

export const name = 'dsh-arxiv-ml-search'

export const inject = ['tools']

const SKILL_FILE = fileURLToPath(new URL('./skills/dsh-arxiv-ml-search/SKILL.md', import.meta.url))

const DESCRIPTION = 'Search arXiv for ML/DL/RL papers and check claims against real abstracts.'

/** Shape of one paper in the search output. */
const SEARCH_PAPER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    authors: { type: 'string' },
    categories: { type: 'string' },
    published: { type: 'string' },
    updated: { type: 'string' },
    abs_url: { type: 'string' },
    pdf_url: { type: 'string' },
    abstract: { type: 'string' },
    abstract_truncated: { type: 'boolean' },
  },
}

/** Shape of one paper in the detail output. */
const DETAIL_PAPER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    authors: { type: 'string' },
    categories: { type: 'string' },
    primary_category: { type: 'string' },
    published: { type: 'string' },
    updated: { type: 'string' },
    abs_url: { type: 'string' },
    pdf_url: { type: 'string' },
    comment: { type: 'string' },
    doi: { type: 'string' },
    journal_ref: { type: 'string' },
    abstract: { type: 'string' },
    segment: { type: 'number' },
    segments_total: { type: 'number' },
  },
}

/**
 * Register the arXiv tools and the companion skill.
 * @param {import('@deepseek-ai/cordis').Context} ctx - cordis context.
 * @param {object} [config] - plugin config from cordis.patch.yml.
 * @returns {() => void} disposer that unregisters everything.
 */
export function apply(ctx, config = {}) {
  const disposers = []
  const defaults = {
    categories: config.categories ?? ML_CATEGORIES,
    abstractChars: config.abstractChars ?? DEFAULT_ABSTRACT_CHARS,
    limit: config.limit ?? 10,
  }
  // Transport settings shared by both tools; `contact` ends up in the
  // User-Agent, which is what arXiv asks API clients to provide.
  const transport = { contact: config.contact, timeoutMs: config.timeoutMs }

  // The skills service is optional: ask for it, never inject it.
  const skills = ctx.get('skills')
  if (skills && typeof skills.register === 'function') {
    try {
      disposers.push(skills.register({
        name: 'dsh-arxiv-ml-search',
        description: DESCRIPTION,
        content: readFileSync(SKILL_FILE, 'utf8'),
        source: 'runtime',
        provider: 'dsh-arxiv-ml-search',
      }))
    } catch (error) {
      ctx.logger?.warn?.('dsh-arxiv-ml-search: failed to register skill: ' + String(error))
    }
  }

  disposers.push(ctx.tools.register(defineTool({
    name: 'arxiv_search',
    description: [
      'Search arXiv for papers. Use it before making any claim about what the ML',
      'literature says. Returns truncated abstracts — call arxiv_get for the full text.',
    ].join(' '),
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'Search terms. Plain text is matched as a phrase; raw arXiv syntax '
          + '(ti:, abs:, au:, cat:, AND/OR/ANDNOT, parentheses) is passed through unchanged.',
      },
      field: {
        type: 'string',
        enum: ['all', 'title', 'abstract'],
        description: 'Where to match plain-text queries. Default: all.',
      },
      authors: {
        type: 'array',
        items: { type: 'string' },
        description: 'Author names; all must appear on the paper.',
      },
      categories: {
        type: 'array',
        items: { type: 'string' },
        description: 'arXiv categories to restrict to, e.g. cs.LG, cs.CL, stat.ML. '
          + 'Omit to search all of arXiv; pass ml_only instead for the usual ML set.',
      },
      ml_only: {
        type: 'boolean',
        description: 'Restrict to the ML categories (' + ML_CATEGORIES.join(', ') + ').',
      },
      from: { type: 'string', description: 'Earliest submission date, YYYY-MM-DD.' },
      to: { type: 'string', description: 'Latest submission date, YYYY-MM-DD.' },
      sort: {
        type: 'string',
        enum: ['relevance', 'submitted', 'updated'],
        description: 'Ranking. Default relevance; use submitted for "what is new".',
      },
      order: { type: 'string', enum: ['descending', 'ascending'], description: 'Sort direction.' },
      limit: { type: 'number', description: 'Results per page, 1-50. Default 10.' },
      offset: { type: 'number', description: 'Result offset, for paging through matches.' },
      abstract_chars: {
        type: 'number',
        description: 'Abstract budget per paper. Default ' + defaults.abstractChars + '.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          total: { type: 'number' },
          offset: { type: 'number' },
          returned: { type: 'number' },
          query: { type: 'string' },
          papers: { type: 'array', items: SEARCH_PAPER_SCHEMA },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderSearch(value) }],
    },
    async execute(args) {
      const categories = args.categories?.length
        ? args.categories
        : (args.ml_only ? defaults.categories : [])
      return search({
        ...args,
        categories,
        limit: args.limit ?? defaults.limit,
        abstract_chars: args.abstract_chars ?? defaults.abstractChars,
      }, transport)
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'arxiv_get',
    description: [
      'Fetch full metadata and the complete abstract for specific arXiv papers.',
      'Use it on the ids arxiv_search returned, before quoting anything from them.',
    ].join(' '),
    parameters: {
      ids: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: 'arXiv ids, e.g. 1706.03762 or 2506.01234v2. URLs are accepted too.',
      },
      segment: {
        type: 'number',
        description: '1-based segment of the abstract to return, when max_chars splits it. '
          + 'The response reports segments_total so you can page.',
      },
      max_chars: {
        type: 'number',
        description: 'Characters per segment. Omit to get the whole abstract.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          requested: { type: 'number' },
          returned: { type: 'number' },
          missing: { type: 'array', items: { type: 'string' } },
          papers: { type: 'array', items: DETAIL_PAPER_SCHEMA },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderDetails(value) }],
    },
    async execute(args) {
      return getPapers(args, transport)
    },
  })))

  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // disposal failures must not break unload
      }
    }
  }
}
