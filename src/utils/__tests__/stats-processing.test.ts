import {
  parseVersion,
  compareVersions,
  _categorizeModules,
  // Import other functions if they get tests: processModuleWebsiteCounts, processModuleDistribution, processVersionDistribution
} from '../stats-processing'; // .js extension will be resolved by Jest
import type {
  VersionComponents,
  ModuleDistribution,
} from '../stats-processing';
import { DEFAULT_MODULE_CATEGORIES } from '../../config/stats-config.js'; // Actual config for some tests
import { vi, describe, it, expect } from 'vitest';
import logger from '../logger.js';

// Mock logger
vi.mock('../logger', () => ({
  default: {
    instance: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

describe('stats-processing', () => {
  describe('parseVersion', () => {
    it('should parse valid version strings correctly', () => {
      expect(parseVersion('1.2.3')).toEqual<VersionComponents>({
        major: 1,
        minor: 2,
        patch: 3,
        preRelease: null,
      });
      expect(parseVersion('v4.5.6')).toEqual<VersionComponents>({
        major: 4,
        minor: 5,
        patch: 6,
        preRelease: null,
      });
      expect(parseVersion('7.8.9-pre.1')).toEqual<VersionComponents>({
        major: 7,
        minor: 8,
        patch: 9,
        preRelease: 'pre.1',
      });
      expect(parseVersion('v10.11.12-alpha-beta')).toEqual<VersionComponents>({
        major: 10,
        minor: 11,
        patch: 12,
        preRelease: 'alpha-beta',
      });
    });

    it('should handle undefined, null, and empty string inputs', () => {
      expect(parseVersion(undefined)).toEqual<VersionComponents>({
        major: 0,
        minor: 0,
        patch: 0,
        preRelease: 'invalid',
      });
      // Assuming null is treated like undefined by the function's logic path for !versionString
      expect(
        parseVersion(null as unknown as string),
      ).toEqual<VersionComponents>({
        major: 0,
        minor: 0,
        patch: 0,
        preRelease: 'invalid',
      });
      expect(parseVersion('')).toEqual<VersionComponents>({
        major: 0,
        minor: 0,
        patch: 0,
        preRelease: 'invalid',
      });
    });

    it('should handle malformed version strings', () => {
      expect(parseVersion('abc')).toEqual<VersionComponents>({
        major: 0,
        minor: 0,
        patch: 0,
        preRelease: 'abc',
      });
      expect(parseVersion('1.2')).toEqual<VersionComponents>({
        major: 0,
        minor: 0,
        patch: 0,
        preRelease: '1.2',
      });
      expect(parseVersion('1.beta')).toEqual<VersionComponents>({
        major: 0,
        minor: 0,
        patch: 0,
        preRelease: '1.beta',
      });
      // Check logger was called for malformed strings (if they are not empty/null/undefined)
      parseVersion('xyz'); // call it
      expect(logger.instance.warn).toHaveBeenCalledWith(
        expect.stringContaining('"xyz"'),
      );
    });
  });

  describe('compareVersions', () => {
    // For Array.prototype.sort((a,b) => compareVersions(a,b)) to sort newest first:
    // if a is newer than b, return < 0
    // if b is newer than a, return > 0
    // if equal, return 0
    it('should correctly compare major versions', () => {
      expect(compareVersions('2.0.0', '1.0.0')).toBeLessThan(0); // 2.0.0 is newer
      expect(compareVersions('1.0.0', '2.0.0')).toBeGreaterThan(0); // 2.0.0 is newer
    });

    it('should correctly compare minor versions', () => {
      expect(compareVersions('1.2.0', '1.1.0')).toBeLessThan(0); // 1.2.0 is newer
      expect(compareVersions('1.1.0', '1.2.0')).toBeGreaterThan(0); // 1.2.0 is newer
    });

    it('should correctly compare patch versions', () => {
      expect(compareVersions('1.1.2', '1.1.1')).toBeLessThan(0); // 1.1.2 is newer
      expect(compareVersions('1.1.1', '1.1.2')).toBeGreaterThan(0); // 1.1.2 is newer
    });

    it('should correctly compare pre-release versions', () => {
      expect(compareVersions('1.0.0', '1.0.0-pre')).toBeLessThan(0); // release is newer than pre-release
      expect(compareVersions('1.0.0-pre', '1.0.0')).toBeGreaterThan(0);
      expect(compareVersions('1.0.0-beta', '1.0.0-alpha')).toBeLessThan(0); // beta is newer than alpha
      expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBeGreaterThan(0);
    });

    it('should handle identical versions', () => {
      expect(compareVersions('1.1.1', '1.1.1')).toBe(0);
      expect(compareVersions('2.0.0-pre', '2.0.0-pre')).toBe(0);
    });

    it('should handle versions that parse to invalid/default components', () => {
      // "invalid" vs "1.0.0" -> 1.0.0 is newer
      expect(compareVersions('invalid', '1.0.0')).toBeGreaterThan(0);
      // "1.0.0" vs "invalid" -> 1.0.0 is newer
      expect(compareVersions('1.0.0', 'invalid')).toBeLessThan(0);
      // "invalid1" vs "invalid2" -> comparison of preRelease strings "invalid1" vs "invalid2"
      expect(compareVersions('invalid1', 'invalid2')).toBeGreaterThan(0); // "invalid2" > "invalid1" lexicographically
    });
  });

  describe('_categorizeModules', () => {
    const minCountThreshold = 2;
    const countExtractor = (count: number) => count;

    // For this test, we use the actual DEFAULT_MODULE_CATEGORIES
    // to ensure 'someOtherModule' correctly falls into the 'other' category.
    it('should categorize modules correctly, respect threshold, and handle "other"', () => {
      const dataSource: ModuleDistribution = {
        rubiconBidAdapter: 5, // Matches bidAdapter
        appnexusBidAdapter: 1, // Matches bidAdapter, but below threshold
        userId: 3, // Matches idModule
        someRtdProvider: 4, // Corrected case: RTDProvider -> RtdProvider
        someAnalyticsAdapter: 5, // Matches analyticsAdapter
        unknownUtilityModule: 6, // Should go to 'other'
      };

      const result = _categorizeModules(
        dataSource,
        minCountThreshold,
        countExtractor,
        DEFAULT_MODULE_CATEGORIES, // Use the actual imported categories
      );

      expect(result.bidAdapter).toEqual({ rubiconBidAdapter: 5 });
      expect(result.idModule).toEqual({ userId: 3 });
      expect(result.rtdModule).toEqual({ someRtdProvider: 4 }); // Corrected case
      expect(result.analyticsAdapter).toEqual({ someAnalyticsAdapter: 5 });
      expect(result.other).toEqual({ unknownUtilityModule: 6 });
      expect(result.bidAdapter['appnexusBidAdapter']).toBeUndefined();
    });

    it('should place modules below threshold nowhere', () => {
      const dataSource: ModuleDistribution = { rubiconBidAdapter: 1 }; // Below threshold of 2
      const result = _categorizeModules(
        dataSource,
        minCountThreshold,
        countExtractor,
        DEFAULT_MODULE_CATEGORIES,
      );
      expect(Object.keys(result.bidAdapter)).toHaveLength(0);
      expect(Object.keys(result.idModule)).toHaveLength(0);
      expect(Object.keys(result.rtdModule)).toHaveLength(0);
      expect(Object.keys(result.analyticsAdapter)).toHaveLength(0);
      expect(Object.keys(result.other)).toHaveLength(0);
    });

    it('should handle empty dataSource', () => {
      const dataSource: ModuleDistribution = {};
      const result = _categorizeModules(
        dataSource,
        minCountThreshold,
        countExtractor,
        DEFAULT_MODULE_CATEGORIES,
      );
      expect(Object.keys(result.bidAdapter)).toHaveLength(0);
      expect(Object.keys(result.idModule)).toHaveLength(0);
      expect(Object.keys(result.rtdModule)).toHaveLength(0);
      expect(Object.keys(result.analyticsAdapter)).toHaveLength(0);
      expect(Object.keys(result.other)).toHaveLength(0);
    });
  });
});
