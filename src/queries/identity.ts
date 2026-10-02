// The two queries the session itself reads, shared with the hooks so there is one of each in the
// cache: the company's brand (public; kept on the device for the next launch, which shows it at
// once and fetches it again) and the investor signed in.

import { queryOptions } from '@tanstack/react-query';
import { MobileApiError } from '../api/MobileApiError';
import type { PlatformApi } from '../api/PlatformApi';
import { brandCache, isBrand } from '../session/brand';
import { queryKey } from './keys';

export function brandQuery(api: PlatformApi) {
  return queryOptions({
    queryKey: queryKey(api.mode, 'brand'),
    queryFn: async () => {
      const brand: unknown = await api.brand();
      // A brand this version cannot use (an unknown theme, a missing field) is a failed fetch:
      // the brand the app has, cached or none, stays.
      if (!isBrand(brand)) throw new MobileApiError('server_error', 0);
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
