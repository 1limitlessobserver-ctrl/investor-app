import { describe, it, expect } from 'vitest';
import { format } from './format';

describe('format', () => {
  it('formats cents as currency', () => {
    expect(format.money(123456)).toBe('$1,234.56');
    expect(format.money(-5000)).toBe('-$50.00');
    expect(format.money(0)).toBe('$0.00');
    expect(format.money(250000, 'EUR')).toBe('€2,500.00');
  });
  it('compacts large amounts', () => {
    expect(format.moneyCompact(123456789)).toBe('$1.23M');
    expect(format.moneyCompact(99900)).toBe('$999');
    expect(format.moneyCompact(14182000)).toBe('$141.82K');
  });
  it('formats percentages', () => {
    expect(format.percent(12.345)).toBe('12.3%');
    expect(format.percent(1.2, { signed: true })).toBe('+1.2%');
    expect(format.percent(-0.5, { signed: true })).toBe('-0.5%');
    expect(format.percent(7, { digits: 0 })).toBe('7%');
  });
  it('formats dates in a fixed zone', () => {
    expect(format.date('2026-09-30T23:30:00.000Z', { timeZone: 'UTC' })).toBe('Sep 30, 2026');
  });
  it('says how long ago', () => {
    const now = new Date('2026-10-01T12:00:00.000Z');
    expect(format.relative('2026-10-01T11:59:40.000Z', now)).toBe('just now');
    expect(format.relative('2026-10-01T11:55:00.000Z', now)).toBe('5m ago');
    expect(format.relative('2026-10-01T09:00:00.000Z', now)).toBe('3h ago');
    expect(format.relative('2026-09-30T10:00:00.000Z', now)).toBe('Yesterday');
    expect(format.relative('2026-09-20T10:00:00.000Z', now)).toBe('Sep 20');
  });
});

describe('format edge cases', () => {
  const now = new Date('2026-10-01T12:00:00.000Z');

  it('writes a large balance in full', () => {
    expect(format.money(1234567890)).toBe('$12,345,678.90');
    expect(format.money(-123456, 'EUR')).toBe('-€1,234.56');
  });
  it('never prints a minus sign in front of zero', () => {
    expect(format.money(-0)).toBe('$0.00');
    expect(format.moneyCompact(-0)).toBe('$0');
    expect(format.percent(-0.04)).toBe('0.0%');
    expect(format.percent(0.04, { signed: true })).toBe('0.0%');
    expect(format.percent(0, { signed: true })).toBe('0.0%');
  });
  it('trims the zeros from compact amounts', () => {
    expect(format.moneyCompact(100000000)).toBe('$1M');
    expect(format.moneyCompact(120000000)).toBe('$1.2M');
    expect(format.moneyCompact(0)).toBe('$0');
    expect(format.moneyCompact(5)).toBe('$0.05');
    expect(format.moneyCompact(-14182000)).toBe('-$141.82K');
    expect(format.moneyCompact(123456789, 'EUR')).toBe('€1.23M');
  });
  it('keeps a fixed number of decimals in a percentage', () => {
    expect(format.percent(8)).toBe('8.0%');
    expect(format.percent(-3.26)).toBe('-3.3%');
    expect(format.percent(12.3456, { digits: 2 })).toBe('12.35%');
    expect(format.percent(1234.56, { signed: true })).toBe('+1,234.6%');
  });
  it('formats a date in the zone it is given', () => {
    expect(format.date('2026-09-30T23:30:00.000Z', { timeZone: 'Asia/Tokyo' })).toBe('Oct 1, 2026');
    expect(format.date('1980-04-12T00:00:00.000Z', { timeZone: 'UTC' })).toBe('Apr 12, 1980');
  });
  it('shows a dash for a date it cannot read', () => {
    expect(format.date('not a date')).toBe('—');
    expect(format.relative('not a date', now)).toBe('—');
  });
  it('moves up a unit exactly on the boundary', () => {
    expect(format.relative('2026-10-01T11:59:01.000Z', now)).toBe('just now');
    expect(format.relative('2026-10-01T11:59:00.000Z', now)).toBe('1m ago');
    expect(format.relative('2026-10-01T11:00:01.000Z', now)).toBe('59m ago');
    expect(format.relative('2026-10-01T11:00:00.000Z', now)).toBe('1h ago');
    expect(format.relative('2026-09-30T12:00:01.000Z', now)).toBe('23h ago');
    expect(format.relative('2026-09-30T12:00:00.000Z', now)).toBe('Yesterday');
    expect(format.relative('2026-09-29T23:59:00.000Z', now)).toBe('Sep 29');
  });
  it('counts hours, not calendar days, for the first 24 hours', () => {
    const early = new Date('2026-10-01T02:00:00.000Z');
    expect(format.relative('2026-09-30T03:00:00.000Z', early)).toBe('23h ago');
    expect(format.relative('2026-09-30T23:59:00.000Z', new Date('2026-10-01T00:30:00.000Z'))).toBe(
      '31m ago',
    );
  });
  it('reads yesterday across the new year and names another year in full', () => {
    expect(format.relative('2025-12-31T05:00:00.000Z', new Date('2026-01-01T10:00:00.000Z'))).toBe(
      'Yesterday',
    );
    expect(format.relative('2025-12-25T10:00:00.000Z', now)).toBe('Dec 25, 2025');
    expect(format.relative('2026-01-05T10:00:00.000Z', now)).toBe('Jan 5');
  });
  it('is kind to a clock that runs fast', () => {
    expect(format.relative('2026-10-01T12:00:30.000Z', now)).toBe('just now');
    expect(format.relative('2026-10-03T12:00:00.000Z', now)).toBe('Oct 3');
  });
});
