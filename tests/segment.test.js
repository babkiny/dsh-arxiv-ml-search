/**
 * Text-budgeting tests: truncation, segmentation and segment selection.
 * @module dsh-arxiv-ml-search/tests/segment
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { segmentText, selectSegment, truncate } from '../lib/segment.js'

const SENTENCE = 'Reinforcement learning from human feedback can miscalibrate a model. '
const LONG = SENTENCE.repeat(40)

test('short text is returned untouched', () => {
  assert.equal(truncate('hello', 100), 'hello')
  assert.equal(truncate('', 100), '')
})

test('truncation cuts on a word boundary and marks the cut', () => {
  const out = truncate('one two three four five six seven', 20)
  assert.ok(out.length <= 21, 'ellipsis aside, stays within budget')
  assert.ok(out.endsWith('…'))
  assert.ok(!out.includes('  '))
  assert.ok('one two three four five six seven'.startsWith(out.slice(0, -1)))
})

test('a single long word is cut hard rather than dropped', () => {
  const out = truncate('a'.repeat(50), 10)
  assert.equal(out, 'a'.repeat(10) + '…')
})

test('text within the budget is one segment', () => {
  const segments = segmentText('short abstract', { maxChars: 1000 })
  assert.deepEqual(segments, [{ index: 1, total: 1, text: 'short abstract' }])
})

test('long text splits into numbered segments that cover it', () => {
  const segments = segmentText(LONG, { maxChars: 400, overlap: 0 })
  assert.ok(segments.length > 1)
  for (const segment of segments) {
    assert.equal(segment.total, segments.length)
    assert.ok(segment.text.length <= 400, 'segment stays within budget')
  }
  assert.deepEqual(segments.map((s) => s.index), segments.map((_, i) => i + 1))
  const rejoined = segments.map((s) => s.text).join(' ')
  assert.equal(rejoined.replace(/\s+/g, ' ').trim(), LONG.replace(/\s+/g, ' ').trim())
})

test('segments break on sentence ends, not mid-word', () => {
  for (const segment of segmentText(LONG, { maxChars: 400, overlap: 0 })) {
    assert.ok(/[.!?]$/.test(segment.text.trim()), 'segment should end on a sentence: ' + segment.text.slice(-30))
  }
})

test('overlap repeats context without stalling', () => {
  const segments = segmentText(LONG, { maxChars: 300, overlap: 80 })
  assert.ok(segments.length > 1)
  // Overlap must not make the walk loop forever or blow up the segment count.
  assert.ok(segments.length < 40, 'segment count should stay proportional')
})

test('paragraph breaks are preferred over sentence ends', () => {
  const text = 'a'.repeat(150) + '. ' + 'b'.repeat(60) + '\n\n' + 'c'.repeat(200)
  const segments = segmentText(text, { maxChars: 260, overlap: 0 })
  assert.ok(segments[0].text.endsWith('b'.repeat(60)), 'first segment should stop at the blank line')
})

test('empty text still yields one empty segment', () => {
  assert.deepEqual(segmentText('   '), [{ index: 1, total: 1, text: '' }])
})

test('selectSegment returns the whole text when it fits', () => {
  const result = selectSegment('one short abstract', undefined, 1000)
  assert.deepEqual(result, { text: 'one short abstract', segment: 1, segments: 1 })
})

test('selectSegment reports how many segments exist', () => {
  const first = selectSegment(LONG, undefined, 400)
  assert.equal(first.segment, 1)
  assert.ok(first.segments > 1)
  const second = selectSegment(LONG, 2, 400)
  assert.equal(second.segment, 2)
  assert.notEqual(second.text, first.text)
})

test('an out-of-range segment clamps to the last one', () => {
  const result = selectSegment(LONG, 999, 400)
  assert.equal(result.segment, result.segments)
  assert.ok(result.text.length > 0)
})
