import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvFile } from './env.js';

test('parses simple KEY=VALUE lines', () => {
  const result = parseEnvFile('FOO=bar\nBAZ=qux');
  assert.deepEqual(result, { FOO: 'bar', BAZ: 'qux' });
});

test('ignores blank lines and comments', () => {
  const result = parseEnvFile('\n# a comment\nFOO=bar\n\n# another\nBAZ=qux\n');
  assert.deepEqual(result, { FOO: 'bar', BAZ: 'qux' });
});

test('strips surrounding quotes', () => {
  const result = parseEnvFile('FOO="bar baz"\nQUX=\'single quoted\'');
  assert.deepEqual(result, { FOO: 'bar baz', QUX: 'single quoted' });
});

test('handles values containing an equals sign', () => {
  const result = parseEnvFile('CONNECTION=host=localhost;port=5432');
  assert.deepEqual(result, { CONNECTION: 'host=localhost;port=5432' });
});

test('ignores malformed lines without throwing', () => {
  const result = parseEnvFile('not a valid line\nFOO=bar\n===\n');
  assert.equal(result.FOO, 'bar');
});

test('empty input yields an empty object', () => {
  assert.deepEqual(parseEnvFile(''), {});
});
