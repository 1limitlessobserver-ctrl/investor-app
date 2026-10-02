import { QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSampleApi } from '../api/createSampleApi';
import { sampleData } from '../sample/sampleData';
import { brandCache } from '../session/brand';
import { createQueryClient } from './client';
import { brandQuery, meQuery } from './identity';

afterEach(() => localStorage.clear());

describe('brandQuery', () => {
  it('keeps each brand it fetches on the device for the next launch', async () => {
    const brand = await createQueryClient().fetchQuery(
      brandQuery(createSampleApi({ latencyMs: 0 })),
    );
    expect(brand.name).toBe('Everest Reserve');
    expect(brandCache.read()).toEqual(brand);
  });

  it('shows the cached brand at once, and fetches it again', () => {
    const api = createSampleApi({ latencyMs: 0 });
    brandCache.write({ ...sampleData.createState().brand, name: 'Cached Company' });
    const observer = new QueryObserver(createQueryClient(), brandQuery(api));
    const result = observer.getCurrentResult();
    expect(result.data?.name).toBe('Cached Company');
    expect(result.isStale).toBe(true);
  });

  it.each([
    ['a theme this app does not know', { defaultTheme: 'nebula' }],
    ['no minimum version', { minSupportedAppVersion: null }],
    ['no links', { links: undefined }],
  ])('refuses a brand with %s, and keeps the one cached', async (_, change) => {
    const api = createSampleApi({ latencyMs: 0 });
    const cached = { ...sampleData.createState().brand, name: 'Cached Company' };
    brandCache.write(cached);
    vi.spyOn(api, 'brand').mockResolvedValue({ ...(await api.brand()), ...change } as never);
    const client = createQueryClient();
    await expect(client.fetchQuery(brandQuery(api))).rejects.toMatchObject({
      code: 'server_error',
      status: 0,
    });
    expect(brandCache.read()).toEqual(cached);
    expect(client.getQueryData(brandQuery(api).queryKey)).toEqual(cached);
  });
});

describe('meQuery', () => {
  it('asks the platform who is signed in', async () => {
    const me = await createQueryClient().fetchQuery(meQuery(createSampleApi({ latencyMs: 0 })));
    expect(me.fullName).toBe('Alex Morgan');
  });
});
