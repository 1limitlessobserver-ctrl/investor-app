import { describe, it, expect } from 'vitest';
import { kycGeo } from './kycGeo';

describe('kycGeo', () => {
  it('offers the website’s countries, with the priority markets among them', () => {
    expect(kycGeo.countries).toHaveLength(190);
    const codes = new Set(kycGeo.countries.map((c) => c.code));
    expect(codes.size).toBe(kycGeo.countries.length);
    expect(kycGeo.priorityCountryCodes.every((code) => codes.has(code))).toBe(true);
    expect(kycGeo.usStates).toHaveLength(56);
  });

  it('offers the submission’s option lists and document types', () => {
    expect(kycGeo.documentTypes.map((d) => d.id)).toEqual([
      'PASSPORT',
      'DRIVERS_LICENSE',
      'NATIONAL_ID',
    ]);
    expect(kycGeo.employmentStatuses).toContain('Self-employed');
    expect(kycGeo.sourcesOfFunds).toContain('Inheritance');
    expect(kycGeo.annualIncomes[0]).toBe('Under $50,000');
    expect(kycGeo.investmentExperiences.at(-1)).toBe('Professional');
  });

  it('names countries and states, with dialing codes and flags', () => {
    expect([kycGeo.countryName('GB'), kycGeo.countryName('ZZ'), kycGeo.countryName(null)]).toEqual([
      'United Kingdom',
      'ZZ',
      '',
    ]);
    expect([kycGeo.dialCode('US'), kycGeo.dialCode('ZZ'), kycGeo.dialCode(undefined)]).toEqual([
      '1',
      '',
      '',
    ]);
    expect([kycGeo.flagEmoji('us'), kycGeo.flagEmoji('USA')]).toEqual(['🇺🇸', '🏳️']);
    expect([kycGeo.usStateName('CA'), kycGeo.usStateName('XX'), kycGeo.usStateName('')]).toEqual([
      'California',
      'XX',
      '',
    ]);
  });
});
