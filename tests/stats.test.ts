import { describe, it, expect, beforeEach, afterEach, vi, jest } from 'vitest'; // Added vi
import { updateAndCleanStats } from '../src/utils/update_stats.js'; // Changed to .js
import mockFs from 'mock-fs'; // Restore mock-fs
import fs from 'fs';
import path from 'path';

const MIN_COUNT_THRESHOLD = 5; // Not used in the first uncommented test, but keep for later

const readMockJson = (filePath: string) => {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')); // Restore readMockJson
};

describe('updateAndCleanStats', () => {
  beforeEach(() => {
    // mockFs({}); // General mockFs setup in beforeEach can be tricky if tests define their own specific structures.
    // Let each test define its full mock structure for clarity.
  });

  afterEach(() => {
    mockFs.restore(); // Restore the real file system after each test
  });

  it('should be a runnable test file', () => {
    expect(true).toBe(true);
  });

  it('should correctly summarize and clean stats, then write to api/api.json', async () => {
    const storePath = path.resolve(process.cwd(), 'src', 'store');
    // Copied mock data structure from the original test plan, adjusted for absolute storePath
    mockFs({
      [storePath]: {
        'Jan': {
          'data1.json': JSON.stringify([
            {
              url: 'http://site1.com',
              prebidInstances: [
                { version: 'v8.2.0', modules: ['rubiconBidAdapter', 'criteoIdSystem', 'sharedIdSystem', 'adagioAnalyticsAdapter', 'coreModuleOnly'] }
              ]
            },
            {
              url: 'http://site2.com',
              prebidInstances: [
                { version: '7.53.0', modules: ['rubiconBidAdapter', 'id5IdSystem', 'connectIdSystem', 'coreModuleOnly', 'belowThresholdModule'] }
              ]
            },
            {
              url: 'http://site3.com',
              prebidInstances: [{}]
            }
          ]),
          'data2.json': JSON.stringify([
            {
              url: 'http://site4.com',
              prebidInstances: [
                { version: 'v9.10.0-pre', modules: ['rubiconBidAdapter', 'pubCommonId', 'realTimeData', 'enrichmentRtdProvider'] }
              ]
            },
            {
              url: 'http://site5.com',
              prebidInstances: [
                { version: 'v1.2.3-custom', modules: ['rubiconBidAdapter', 'utiqSystem', 'customAnalyticsAdapter'] }
              ]
            },
            {
              url: 'http://site6.com',
              prebidInstances: [
                { version: '9.35', modules: ['rubiconBidAdapter', 'trustpidSystem', 'coreModuleOnly'] }
              ]
            }
          ]),
        },
        'Feb': {
          'data3.json': JSON.stringify([
            {
              url: 'http://site1.com', // Repeat site1
              prebidInstances: [
                { version: 'v8.2.0', modules: ['rubiconBidAdapter', 'criteoIdSystem', 'appnexusBidAdapter'] }
              ]
            },
            {
              url: 'http://site7.com', // No Prebid
            }
          ])
        },
        'Mar': { // Add more data to ensure some modules pass threshold
            'data4.json': JSON.stringify([
                { url: 'http://site8.com', prebidInstances: [{ version: 'v8.2.0', modules: ['rubiconBidAdapter', 'appnexusBidAdapter', 'criteoIdSystem'] }] },
                { url: 'http://site9.com', prebidInstances: [{ version: 'v8.2.0', modules: ['rubiconBidAdapter', 'appnexusBidAdapter', 'criteoIdSystem'] }] },
                { url: 'http://site10.com', prebidInstances: [{ version: 'v8.2.0', modules: ['rubiconBidAdapter', 'appnexusBidAdapter', 'criteoIdSystem', 'sharedIdSystem'] }] },
                { url: 'http://site11.com', prebidInstances: [{ version: 'v8.2.0', modules: ['appnexusBidAdapter', 'sharedIdSystem'] }] },
            ])
        }
      },
      'api': {}
    });


    await updateAndCleanStats();

    const outputPath = path.join('api', 'api.json');
    expect(fs.existsSync(outputPath)).toBe(true);
    const outputData = readMockJson(outputPath);

    // Assertions from the original test plan
    expect(outputData.visitedSites).toBe(11);
    expect(outputData.monitoredSites).toBe(11);
    expect(outputData.prebidSites).toBe(10);

    expect(outputData.releaseVersions['8.2.0']).toBe(6); // Corrected from 5 to 6
    expect(outputData.releaseVersions['7.53.0']).toBe(1);
    expect(outputData.releaseVersions['9.35']).toBe(1); // Moved from customVersions and corrected
    expect(outputData.buildVersions['9.10.0-pre']).toBe(1);
    expect(outputData.customVersions['1.2.3-custom']).toBe(1);
    expect(outputData.customVersions['9.35']).toBeUndefined(); // Should not be in customVersions

    // Module counts based on MIN_COUNT_THRESHOLD = 5 (defined in stats.test.ts)
    expect(outputData.bidAdapterInst['rubiconBidAdapter']).toBe(9); // Corrected from 8 to 9
    expect(outputData.bidAdapterInst['appnexusBidAdapter']).toBe(5);
    expect(outputData.idModuleInst['criteoIdSystem']).toBe(5);

    // These were previously expected to be undefined due to wrong threshold calculation in plan
    // Recalculating based on data:
    // sharedIdSystem: site1(Jan), site10(Mar), site11(Mar) = 3. This IS below threshold.
    // coreModuleOnly: site1(Jan), site2(Jan), site6(Jan) = 3. This IS below threshold.
    expect(outputData.idModuleInst['sharedIdSystem']).toBeUndefined();
    expect(outputData.otherModuleInst['coreModuleOnly']).toBeUndefined();

    expect(outputData.rtdModuleInst['realTimeData']).toBeUndefined();
    expect(outputData.analyticsAdapterInst['adagioAnalyticsAdapter']).toBeUndefined();
    expect(outputData.bidAdapterInst['nonExistentAdapter']).toBeUndefined();
    expect(outputData.otherModuleInst['belowThresholdModule']).toBeUndefined();
  });

  it('should handle empty store directory', async () => {
    // outputDir in update_stats.ts resolves to path.join(__dirname, '..', 'store')
    // where __dirname is /app/src/utils, so outputDir is /app/src/store
    const storePath = path.resolve(process.cwd(), 'src', 'store');
    mockFs({ // Define mock structure for this specific test
      [storePath]: {}, // Mock the specific absolute path
      'api': {} // api directory must exist for writeFile to place api.json
    });

    await updateAndCleanStats();

    const outputPath = path.join('api', 'api.json');
    expect(fs.existsSync(outputPath)).toBe(true); // Check if output file was created
    const outputData = readMockJson(outputPath);

    expect(outputData.visitedSites).toBe(0);
    expect(outputData.monitoredSites).toBe(0);
    expect(outputData.prebidSites).toBe(0);
    expect(Object.keys(outputData.releaseVersions).length).toBe(0);
    // Check one module category
    expect(Object.keys(outputData.bidAdapterInst || {}).length).toBe(0);
  });

  it('should handle store directory with empty month directories', async () => {
    const storePath = path.resolve(process.cwd(), 'src', 'store');
    mockFs({
      [storePath]: {
        'Jan': {}, // Empty month directory
        'Feb': {}  // Another empty month directory
      },
      'api': {}
    });

    // Removed incorrect console.log from here

    await updateAndCleanStats();
    const outputData = readMockJson(path.join('api', 'api.json'));
    expect(outputData.visitedSites).toBe(0);
    expect(outputData.monitoredSites).toBe(0);
    expect(outputData.prebidSites).toBe(0);
  });

  it('should handle store directory with month directories having no json files', async () => {
    const storePath = path.resolve(process.cwd(), 'src', 'store');
    mockFs({
      [storePath]: {
        'Jan': { 'not-a-json.txt': 'hello' }, // Month directory with a non-JSON file
      },
      'api': {}
    });
    await updateAndCleanStats();
    const outputData = readMockJson(path.join('api', 'api.json'));
    expect(outputData.visitedSites).toBe(0);
    expect(outputData.monitoredSites).toBe(0);
    expect(outputData.prebidSites).toBe(0);
  });

  it('should handle JSON files with invalid content (e.g. not an array)', async () => {
    const mockLogError = vi.fn();
    // const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); // Using mockLogError instead

    const storePath = path.resolve(process.cwd(), 'src', 'store');
    mockFs({
      [storePath]: {
        'Jan': { 'invalid.json': 'unbalanced[[[' }, // Made content unequivocally invalid JSON
        'Feb': {
            'data-valid.json': JSON.stringify([{ url: 'http://site-valid.com', prebidInstances: [{ version: 'v1.0.0', modules: ['testModule']}]}])
        }
      },
      'api': {}
    });

    await updateAndCleanStats({ logError: mockLogError });
    const outputData = readMockJson(path.join('api', 'api.json'));

    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining('Error parsing JSON file /app/src/store/Jan/invalid.json'),
      'SyntaxError', // Expected error name from JSON.parse
      expect.any(String) // Error message from JSON.parse
    );
    expect(outputData.visitedSites).toBe(1);
    expect(outputData.prebidSites).toBe(1);
    expect(outputData.releaseVersions['1.0.0']).toBe(1);
    expect(outputData.otherModuleInst['testModule']).toBeUndefined();

    // mockLogError doesn't need restore unless it was a spy on an object method. vi.fn() is a bare mock.
  });
});
