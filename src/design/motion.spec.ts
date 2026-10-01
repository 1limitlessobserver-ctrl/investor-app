import { describe, it, expect } from 'vitest';
import { motion } from './motion';

describe('motion', () => {
  it('animates only with motion allowed and the app visible', () => {
    expect(motion(false, false).animate).toBe(true);
    expect(motion(true, false).animate).toBe(false);
    expect(motion(false, true).animate).toBe(false);
  });
});
