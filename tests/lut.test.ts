import { it, expect } from 'vitest';
import { parseCube } from '../src/engine/lut';

it('parses an identity 2x2x2 cube with r varying fastest', () => {
  const rows: string[] = [];
  for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) rows.push(`${r} ${g} ${b}`);
  const lut = parseCube(`TITLE "id"\n# comment\nLUT_3D_SIZE 2\n${rows.join('\n')}\n`);
  expect(lut.size).toBe(2);
  expect(lut.title).toBe('id');
  expect(Array.from(lut.data.slice(4, 8))).toEqual([255, 0, 0, 255]);   // index 1 = r=1
  expect(Array.from(lut.data.slice(8, 12))).toEqual([0, 255, 0, 255]);  // index 2 = g=1
});
it('rejects malformed files', () => {
  expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0\n')).toThrow();
});
