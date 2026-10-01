import { readFileSync } from 'node:fs';
import { z } from 'zod';

export const companyConfigSchema = z.object({
  platformUrl: z.union([
    z.literal(''),
    z
      .string()
      .url()
      .regex(/^https:\/\/[^/]+$/, 'HTTPS origin without a path or trailing slash'),
  ]),
  productName: z.string().min(1).max(60),
  shortName: z.string().min(1).max(12),
  identifier: z
    .string()
    .regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/, 'reverse-domain id like com.company.invest'),
  icon: z.string().min(1),
  accentFallback: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'hex colour like #6EA8FF'),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'hex colour like #05070F'),
});
export type CompanyConfig = z.infer<typeof companyConfigSchema>;

export function loadCompanyConfig(path = 'company.config.json'): CompanyConfig {
  const parsed = companyConfigSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`company.config.json is invalid:\n${issues}`);
  }
  return parsed.data;
}
