import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeFieldValue } from './utils.js';
import { findMatchingOption, findMatchingIteration } from './fields.js';

describe('normalizeFieldValue separator handling (#123)', () => {
  it('treats slash, hyphen, underscore, and whitespace as equivalent separators', () => {
    assert.strictEqual(normalizeFieldValue('Q4/2026'), 'q4 2026');
    assert.strictEqual(normalizeFieldValue('Q4-2026'), 'q4 2026');
    assert.strictEqual(normalizeFieldValue('Q4_2026'), 'q4 2026');
    assert.strictEqual(normalizeFieldValue('Q4 2026'), 'q4 2026');
  });

  it('collapses runs of mixed separators to a single space', () => {
    assert.strictEqual(normalizeFieldValue('Q4 / 2026'), 'q4 2026');
    assert.strictEqual(normalizeFieldValue('Q4  --  2026'), 'q4 2026');
  });

  it('still strips emojis and other special characters', () => {
    assert.strictEqual(normalizeFieldValue('🚀 In Progress!'), 'in progress');
    assert.strictEqual(normalizeFieldValue('Done ✅'), 'done');
  });

  it('strips punctuation that is not a separator (e.g. pipe)', () => {
    assert.strictEqual(normalizeFieldValue('a|b'), 'ab');
  });

  it('preserves accented / non-ASCII letters instead of stripping them', () => {
    assert.strictEqual(normalizeFieldValue('Café'), 'café');
    assert.strictEqual(normalizeFieldValue('MÜNCHEN'), 'münchen');
  });

  it('treats underscore as an interchangeable separator too', () => {
    assert.strictEqual(normalizeFieldValue('Q4_2026'), 'q4 2026');
    assert.strictEqual(normalizeFieldValue('foo_bar'), 'foo bar');
    assert.strictEqual(normalizeFieldValue('foo_/_bar'), 'foo bar');
  });

  it('returns an empty string for falsy input', () => {
    assert.strictEqual(normalizeFieldValue(''), '');
    assert.strictEqual(normalizeFieldValue(null), '');
    assert.strictEqual(normalizeFieldValue(undefined), '');
  });
});

describe('findMatchingIteration (#123)', () => {
  const field = {
    configuration: {
      iterations: [
        { id: 'iter-q4', title: 'Q4 2026', startDate: '2026-10-01', duration: 90 },
        { id: 'iter-q1', title: 'Q1 2027', startDate: '2027-01-01', duration: 90 }
      ]
    }
  };

  it('matches a slash-separated value against a space-separated iteration title', () => {
    const match = findMatchingIteration(field, 'Q4/2026');
    assert.ok(match);
    assert.strictEqual(match.id, 'iter-q4');
  });

  it('matches a hyphen-separated value too', () => {
    const match = findMatchingIteration(field, 'Q4-2026');
    assert.ok(match);
    assert.strictEqual(match.id, 'iter-q4');
  });

  it('still matches an exact title', () => {
    const match = findMatchingIteration(field, 'Q1 2027');
    assert.ok(match);
    assert.strictEqual(match.id, 'iter-q1');
  });

  it('returns null when no iteration matches', () => {
    assert.strictEqual(findMatchingIteration(field, 'Q2/2027'), null);
  });
});

describe('findMatchingOption (#123)', () => {
  const options = [
    { id: 'opt-a', name: 'In / Out' },
    { id: 'opt-b', name: 'Done' }
  ];

  it('matches across differing separator styles', () => {
    const match = findMatchingOption(options, 'In - Out');
    assert.ok(match);
    assert.strictEqual(match.id, 'opt-a');
  });
});
