import { describe, expect, it } from 'vitest';
import { appConfig, readAppConfig } from './appConfig';

describe('readAppConfig', () => {
  it('reads the company values apply-company writes, trimmed', () => {
    const config = readAppConfig(
      {
        VITE_PLATFORM_URL: ' https://invest.example.com/ ',
        VITE_PRODUCT_NAME: ' Northwind Wealth ',
        VITE_SHORT_NAME: 'Northwind',
        VITE_ACCENT_FALLBACK: '#3366FF',
      },
      '1.4.2',
    );
    expect(config).toEqual({
      platformUrl: 'https://invest.example.com',
      productName: 'Northwind Wealth',
      shortName: 'Northwind',
      accentFallback: '#3366FF',
      appVersion: '1.4.2',
    });
  });

  it('is sample mode, with the Orbital accent, when the values are missing or blank', () => {
    expect(readAppConfig({ VITE_PLATFORM_URL: '  ' }, '0.1.0')).toEqual({
      platformUrl: '',
      productName: '',
      shortName: '',
      accentFallback: '#6ea8ff',
      appVersion: '0.1.0',
    });
  });

  it('keeps only an accent written as #RRGGBB', () => {
    for (const accent of ['blue', '#36f', '#3366FFAA', '3366FF']) {
      expect(readAppConfig({ VITE_ACCENT_FALLBACK: accent }, '1.0.0').accentFallback).toBe(
        '#6ea8ff',
      );
    }
  });
});

describe('appConfig', () => {
  it('carries the package version the build defines', () => {
    expect(appConfig.appVersion).toMatch(/^\d+\.\d+\.\d+/);
  });
});
