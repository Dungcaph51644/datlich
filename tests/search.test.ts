import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesSearch, normalizeSearch } from '../src/search';

test('Vietnamese search handles accents, uppercase, decomposed Unicode and đ', () => {
  assert.equal(normalizeSearch('  ĐẶNG   Mỹ LINH  '), 'dang my linh');
  assert.equal(matchesSearch('Dũng CL-0001', 'dung'), true);
  assert.equal(matchesSearch('Yến CL-0002', 'yen'), true);
  assert.equal(matchesSearch('Mỹ Linh CL-0003'.normalize('NFD'), 'my linh'), true);
  assert.equal(matchesSearch('Newbie Long CL-0004', '  newbie   long  '), true);
  assert.equal(matchesSearch('Ái CL-0011', 'cl-0011'), true);
  assert.equal(matchesSearch('Chi CL-0006', 'yen'), false);
  assert.equal(matchesSearch('Chi CL-0006', ' '), true);
});
