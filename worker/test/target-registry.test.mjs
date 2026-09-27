import test from 'node:test';
import assert from 'node:assert/strict';
import { TARGETS, getTarget } from '../dist/domain/target.js';

test('registry contains exactly the fixed ai-agent target', () => {
  assert.deepEqual(Object.keys(TARGETS), ['ai-agent']);
  assert.equal(TARGETS['ai-agent'].name, 'AIエージェントPC');
  assert.equal(TARGETS['ai-agent'].relayId, 'home-gateway');
  assert.equal(getTarget('nope'), undefined);
});
