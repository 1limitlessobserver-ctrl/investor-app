// The two queries the session itself reads, shared with the hooks so there is one of each in the
// cache: the company's brand (public; kept on the device for the next launch, which shows it at
// once and fetches it again) and the investor signed in.

import { queryOptions } from '@tanstack/react-query';
import type { PlatformApi } from '../api/PlatformApi';
import { brandCache } from '../session/brand';
import { queryKey } from './keys';

export function brandQuery(api: PlatformApi) {
  return queryOptions({
    queryKey: queryKey(api.mode, 'brand'),
    queryFn: async () => {
      const brand = await api.brand();
      brandCache.write(brand);
      return brand;
    },
    initialData: () => brandCache.read() ?? undefined,
    // As old as can be: the cached brand shows at once and is fetched again.
    initialDataUpdatedAt: 0,
  });
}

export function meQuery(api: PlatformApi) {
  return queryOptions({ queryKey: queryKey(api.mode, 'me'), queryFn: () => api.me() });
}
