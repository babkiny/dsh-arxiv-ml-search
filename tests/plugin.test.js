/**
 * Plugin-contract tests: load index.js against the real `defineTool` from
 * @deepseek-ai/dsh-tools, so a breaking change in the harness API fails here
 * rather than at boot time.
 *
 * These need the dependency installed (`pnpm install`); the lib/ suites do not.
 *
 * @module dsh-arxiv-ml-search/tests/plugin
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as plugin from '../index.js'

/**
 * Build a cordis context stand-in that records what the plugin registers.
 * @param {object} [options] - `{ skills: false }` omits the optional service.
 * @returns {object} the fake context plus the captured registrations.
 */
function fakeContext(options = {}) {
  const tools = new Map()
  const skills = []
  const disposed = []
  const ctx = {
    get: (service) => {
      if (service !== 'skills' || options.skills === false) return undefined
      return {
        register: (skill) => {
          skills.push(skill)
          return () => disposed.push('skill:' + skill.name)
        },
      }
    },
    tools: {
      register: (tool) => {
        tools.set(tool.name, tool)
        return () => disposed.push('tool:' + tool.name)
      },
    },
    logger: { warn: () => {} },
  }
  return { ctx, tools, skills, disposed }
}

test('the plugin exports the cordis entry contract', () => {
  assert.equal(plugin.name, 'dsh-arxiv-ml-search')
  assert.deepEqual(plugin.inject, ['tools'])
  assert.equal(typeof plugin.apply, 'function')
})

test('apply registers both tools and the skill', () => {
  const { ctx, tools, skills } = fakeContext()
  plugin.apply(ctx, {})
  assert.deepEqual([...tools.keys()], ['arxiv_search', 'arxiv_get'])
  assert.equal(skills.length, 1)
  assert.equal(skills[0].name, 'dsh-arxiv-ml-search')
  assert.ok(skills[0].content.includes('arxiv_search'), 'SKILL.md should be shipped and read')
})

test('the tools survive defineTool validation with usable schemas', () => {
  const { ctx, tools } = fakeContext()
  plugin.apply(ctx, {})
  for (const tool of tools.values()) {
    assert.ok(tool.description.length > 0)
    assert.equal(tool.output.schema.type, 'object')
    // Object output schemas must declare additionalProperties or the harness
    // rejects them at registration.
    assert.equal(tool.output.schema.additionalProperties, false)
    assert.equal(typeof tool.output.render, 'function')
    assert.equal(typeof tool.execute, 'function')
  }
})

test('unloading disposes every registration', () => {
  const { ctx, disposed } = fakeContext()
  const dispose = plugin.apply(ctx, {})
  assert.equal(typeof dispose, 'function')
  dispose()
  assert.deepEqual(disposed.sort(), ['skill:dsh-arxiv-ml-search', 'tool:arxiv_get', 'tool:arxiv_search'])
})

test('a harness without the skills service still loads the tools', () => {
  const { ctx, tools, skills } = fakeContext({ skills: false })
  const dispose = plugin.apply(ctx, {})
  assert.equal(tools.size, 2)
  assert.equal(skills.length, 0)
  dispose()
})

test('defineTool compiles the shorthand into a parameter schema', () => {
  const { ctx, tools } = fakeContext()
  plugin.apply(ctx, {})
  const search = tools.get('arxiv_search')
  assert.equal(search.parameters.type, 'object')
  assert.deepEqual(search.parameters.required, ['query'])
  assert.deepEqual(search.parameters.properties.field.enum, ['all', 'title', 'abstract'])
  assert.equal(search.parameters.properties.authors.type, 'array')
  assert.deepEqual(tools.get('arxiv_get').parameters.required, ['ids'])
})

test('config overrides reach the tool descriptions', () => {
  const { ctx, tools } = fakeContext()
  plugin.apply(ctx, { abstractChars: 999 })
  assert.ok(tools.get('arxiv_search').parameters.properties.abstract_chars.description.includes('999'))
})
