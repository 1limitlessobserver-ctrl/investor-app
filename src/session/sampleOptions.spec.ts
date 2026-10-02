import { describe, expect, it } from 'vitest';
import { readSampleOptions } from './sampleOptions';

describe('readSampleOptions', () => {
  it('reads the stress world, the latency and the minimum version from the address', () => {
    expect(
      readSampleOptions('?sampleStress=1&sampleLatency=1200&sampleMinVersion=99.0.0&next=%2F'),
    ).toEqual({ stress: true, latencyMs: 1200, minSupportedAppVersion: '99.0.0' });
  });

  it('leaves out what the address does not set', () => {
    expect(readSampleOptions('')).toEqual({});
    expect(readSampleOptions('?next=%2Fportfolio')).toEqual({});
  });

  it('ignores values it cannot use', () => {
    expect(readSampleOptions('?sampleStress=yes&sampleLatency=-5&sampleMinVersion=%20')).toEqual(
      {},
    );
    expect(readSampleOptions('?sampleLatency=fast')).toEqual({});
    expect(readSampleOptions('?sampleLatency=2.5')).toEqual({});
    expect(readSampleOptions('?sampleLatency=600000')).toEqual({ latencyMs: 10_000 });
    expect(readSampleOptions('?sampleLatency=0')).toEqual({ latencyMs: 0 });
  });
});
