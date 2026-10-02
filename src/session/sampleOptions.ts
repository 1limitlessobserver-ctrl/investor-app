// The sample world's options from the address, read once per launch in sample mode, for the audits
// and demos: `?sampleStress=1` (the overflow audit's world), `?sampleLatency=<ms>` (how long every
// call waits) and `?sampleMinVersion=<version>` (what GET /brand reports as the minimum version,
// to show the update screen).

import type { SampleApiOptions } from '../api/createSampleApi';

/** Longer than this would only look broken. */
const MAX_LATENCY_MS = 10_000;

export type SampleUrlOptions = Pick<
  SampleApiOptions,
  'stress' | 'latencyMs' | 'minSupportedAppVersion'
>;

/** The options `search` sets; a value the sample cannot use is left out. */
export function readSampleOptions(search: string): SampleUrlOptions {
  const params = new URLSearchParams(search);
  const options: SampleUrlOptions = {};
  if (params.get('sampleStress') === '1') options.stress = true;
  const latency = params.get('sampleLatency');
  if (latency !== null && /^\d+$/.test(latency)) {
    options.latencyMs = Math.min(Number(latency), MAX_LATENCY_MS);
  }
  const minimum = params.get('sampleMinVersion')?.trim();
  if (minimum) options.minSupportedAppVersion = minimum;
  return options;
}
