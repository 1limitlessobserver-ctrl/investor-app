// What liveRoutes holds that can be checked without a client: which routes go out without the
// bearer. The route table itself is checked against the platform's request lines in the wire spec
// (createLiveApi.wire.spec.ts), whose rows also drive the client through every method.
import { describe, expect, it } from 'vitest';
import { isPublic, PUBLIC_ROUTES, ROUTES, type ApiMethod } from './liveRoutes';

describe('the live routes', () => {
  it('names the public routes, the brand, sign-in and refresh, and nothing else', () => {
    const publicRoutes: ApiMethod[] = ['brand', 'login', 'loginTwoFactor', 'refresh'];
    expect([...PUBLIC_ROUTES].sort()).toEqual([...publicRoutes].sort());
    const everyMethod = Object.keys(ROUTES) as ApiMethod[];
    expect(everyMethod.filter(isPublic).sort()).toEqual([...publicRoutes].sort());
  });
});
