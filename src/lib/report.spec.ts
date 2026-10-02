import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportProblem } from './report';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reportProblem', () => {
  it('tells the console where it happened and what was thrown, and nothing else', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = new Error('disk error');
    reportProblem('sign-out: clearing the lock', error);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[investor-app] sign-out: clearing the lock:', error);
  });

  it('takes anything that was thrown, not only an Error', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reportProblem('launch', 'a string');
    reportProblem('launch', undefined);
    expect(warn.mock.calls).toEqual([
      ['[investor-app] launch:', 'a string'],
      ['[investor-app] launch:', undefined],
    ]);
  });
});
