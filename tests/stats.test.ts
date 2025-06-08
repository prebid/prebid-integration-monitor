/**
 * @file Test suite for the stats generation and cleaning utility.
 * This file contains tests for the `updateAndCleanStats` function,
 * ensuring it correctly processes mock data, summarizes statistics,
 * and cleans data based on predefined thresholds.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'; // Added vi
import { updateAndCleanStats } from '../src/utils/update-stats'; // Corrected import path
import { initializeLogger } from '../src/utils/logger'; // Import initializeLogger
import mockFs from 'mock-fs'; // Restore mock-fs
import fs from 'fs';
import path from 'path';

import { FinalApiData } from '../src/utils/update-stats'; // Importing for clarity

/**
 * @function readMockJson
 * @description Helper function to read and parse a JSON file from the mock file system.
 * This is used within tests to load expected output data or mock input data
 * that has been written to the mock file system.
 * @param {string} filePath - The path to the JSON file within the mock file system.
 * @returns {any} The parsed JSON object.
 */
const readMockJson = (filePath: string) => {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')); // Restore readMockJson
};

/**
 * @describe Tests for `updateAndCleanStats` function.
 * This suite tests the functionality of `updateAndCleanStats`, including
 * its ability to read data from a mock file system, process it,
 * summarize various statistics (like Prebid.js versions, module usage),
 * filter out data below a certain threshold, and write the final
 * statistics to an output JSON file.
 */
describe('updateAndCleanStats', () => {
  /**
   * @beforeEach Sets up the mock file system before each test.
   * This function is called before each test case runs. It currently does not
   * set up a general mock structure, as tests define their own specific file
   * system mocks for clarity and isolation.
   */
  beforeEach(() => {
    // Initialize the logger before each test in this suite
    // Use a temporary directory for logs during testing
    const testLogDir = path.join(process.cwd(), 'temp-test-logs');
    initializeLogger(testLogDir);
    // mockFs({}); // General mockFs setup in beforeEach can be tricky if tests define their own specific structures.
    // Let each test define its full mock structure for clarity.
  });

  /**
   * @afterEach Restores the real file system after each test.
   * This function is called after each test case completes. It ensures that
   * the mock file system is removed and the original `fs` module functionality
   * is restored, preventing interference between tests or with other operations.
   */
  afterEach(() => {
    mockFs.restore(); // Restore the real file system after each test
  });

  /**
   * @it Ensures that the test file itself is runnable and vitest is configured correctly.
   * @expectedOutcome The test should pass, confirming the basic test setup is operational.
   */
  it('should be a runnable test file', () => {
    expect(true).toBe(true);
  });

  /**
   * @it Tests the core functionality of `updateAndCleanStats` with a comprehensive dataset.
   * This test simulates a directory structure with mock data files representing
   * website scan results over several months. It checks if the function correctly:
   * - Reads and parses all mock data.
   * - Aggregates statistics for Prebid.js versions (release, build, custom).
   * - Counts instances and unique websites for various module types (bid adapters, ID modules, etc.).
   * - Filters out modules and versions that don't meet a minimum count threshold.
   * - Writes the processed and cleaned statistics to `api/api.json`.
   * @expectedOutcome The `api/api.json` file should contain accurate aggregated data. This includes correct site counts (visited, monitored, Prebid-enabled), categorized Prebid.js versions, and counts for module instances and unique websites per module, all reflecting filtering based on predefined thresholds.
   */

  // storePath is used by multiple tests, so define it at a higher scope.
  // It should match the path resolved by OUTPUT_DIR in stats-config.ts
  const storePath = path.resolve(process.cwd(), 'store');

  /**
   * @typedef {Object} SiteCounts
   * @property {number} visitedSites
   * @property {number} monitoredSites
   * @property {number} prebidSites
   */

  /**
   * Asserts the site counts in the output data.
   * @param {FinalApiData} actualData - The actual data from `api.json`.
   * @param {SiteCounts} expectedCounts - The expected site counts.
   */
  function assertSiteCounts(
    actualData: FinalApiData,
    expectedCounts: {
      visitedSites: number;
      monitoredSites: number;
      prebidSites: number;
    }
  ) {
    expect(
      actualData.visitedSites,
      `Expected visitedSites to be ${expectedCounts.visitedSites}`
    ).toBe(expectedCounts.visitedSites);
    expect(
      actualData.monitoredSites,
      `Expected monitoredSites to be ${expectedCounts.monitoredSites}`
    ).toBe(expectedCounts.monitoredSites);
    expect(
      actualData.prebidSites,
      `Expected prebidSites to be ${expectedCounts.prebidSites}`
    ).toBe(expectedCounts.prebidSites);
  }

  /**
   * @typedef {Object} VersionCounts
   * @property {{[version: string]: number}} releaseVersions
   * @property {{[version: string]: number}} buildVersions
   * @property {{[version: string]: number}} customVersions
   */

  /**
   * Asserts the Prebid.js version counts in the output data.
   * @param {FinalApiData} actualData - The actual data from `api.json`.
   * @param {VersionCounts} expectedCounts - The expected version counts.
   */
  function assertVersionCounts(
    actualData: FinalApiData,
    expectedCounts: {
      releaseVersions: { [key: string]: number };
      buildVersions: { [key: string]: number };
      customVersions: { [key: string]: number };
    }
  ) {
    expect(
      actualData.releaseVersions,
      'Expected releaseVersions to match'
    ).toEqual(expectedCounts.releaseVersions);
    expect(actualData.buildVersions, 'Expected buildVersions to match').toEqual(
      expectedCounts.buildVersions
    );
    expect(
      actualData.customVersions,
      'Expected customVersions to match'
    ).toEqual(expectedCounts.customVersions);
  }

  /**
   * @typedef {Object} ModuleInstanceCounts
   * @property {{[moduleName: string]: number} | undefined} bidAdapterInst
   * @property {{[moduleName: string]: number} | undefined} idModuleInst
   * @property {{[moduleName: string]: number} | undefined} analyticsAdapterInst
   * @property {{[moduleName: string]: number} | undefined} rtdModuleInst
   * @property {{[moduleName: string]: number} | undefined} otherModuleInst
   */

  /**
   * Asserts the module instance counts in the output data.
   * @param {FinalApiData} actualData - The actual data from `api.json`.
   * @param {Partial<ModuleInstanceCounts>} expectedCounts - The expected module instance counts.
   *                                                        Use Partial as some categories might be undefined if no modules meet threshold.
   */
  function assertModuleInstanceCounts(
    actualData: FinalApiData,
    expectedCounts: Partial<ModuleInstanceCounts>
  ) {
    expect(
      actualData.bidAdapterInst,
      'Expected bidAdapterInst to match'
    ).toEqual(expectedCounts.bidAdapterInst || {});
    expect(actualData.idModuleInst, 'Expected idModuleInst to match').toEqual(
      expectedCounts.idModuleInst || {}
    );
    expect(
      actualData.analyticsAdapterInst,
      'Expected analyticsAdapterInst to match'
    ).toEqual(expectedCounts.analyticsAdapterInst || {});
    expect(actualData.rtdModuleInst, 'Expected rtdModuleInst to match').toEqual(
      expectedCounts.rtdModuleInst || {}
    );
    expect(
      actualData.otherModuleInst,
      'Expected otherModuleInst to match'
    ).toEqual(expectedCounts.otherModuleInst || {});
  }

  /**
   * @typedef {Object} ModuleWebsiteCounts
   * @property {{[moduleName: string]: number} | undefined} bidAdapterWebsites
   * @property {{[moduleName: string]: number} | undefined} idModuleWebsites
   * @property {{[moduleName: string]: number} | undefined} analyticsAdapterWebsites
   * @property {{[moduleName: string]: number} | undefined} rtdModuleWebsites
   * @property {{[moduleName: string]: number} | undefined} otherModuleWebsites
   */

  /**
   * Asserts the module website counts in the output data.
   * @param {FinalApiData} actualData - The actual data from `api.json`.
   * @param {Partial<ModuleWebsiteCounts>} expectedCounts - The expected module website counts.
   */
  function assertModuleWebsiteCounts(
    actualData: FinalApiData,
    expectedCounts: Partial<ModuleWebsiteCounts>
  ) {
    expect(
      actualData.bidAdapterWebsites,
      'Expected bidAdapterWebsites to match'
    ).toEqual(expectedCounts.bidAdapterWebsites || {});
    expect(
      actualData.idModuleWebsites,
      'Expected idModuleWebsites to match'
    ).toEqual(expectedCounts.idModuleWebsites || {});
    expect(
      actualData.analyticsAdapterWebsites,
      'Expected analyticsAdapterWebsites to match'
    ).toEqual(expectedCounts.analyticsAdapterWebsites || {});
    expect(
      actualData.rtdModuleWebsites,
      'Expected rtdModuleWebsites to match'
    ).toEqual(expectedCounts.rtdModuleWebsites || {});
    expect(
      actualData.otherModuleWebsites,
      'Expected otherModuleWebsites to match'
    ).toEqual(expectedCounts.otherModuleWebsites || {});
  }

  /**
   * Mock file system structure for the comprehensive test case.
   * Simulates data collected over several months.
   */
  const mockComprehensiveData = {
    [storePath]: {
      Jan: {
        'data1.json': JSON.stringify([
          {
            url: 'http://site1.com',
            prebidInstances: [
              {
                version: 'v8.2.0',
                modules: [
                  'rubiconBidAdapter',
                  'criteoIdSystem',
                  'sharedIdSystem',
                  'adagioAnalyticsAdapter',
                  'coreModuleOnly',
                ],
              },
              {
                version: 'v8.1.0',
                modules: ['criteoIdSystem', 'anotherModule'],
              }, // `anotherModule` helps test website count for criteoIdSystem vs other modules on same site
            ],
          },
          {
            url: 'http://site2.com',
            prebidInstances: [
              {
                version: '7.53.0',
                modules: [
                  'rubiconBidAdapter',
                  'id5IdSystem',
                  'connectIdSystem',
                  'coreModuleOnly',
                  'belowThresholdModule',
                ],
              }, // `belowThresholdModule` intended to be filtered.
            ],
          },
          {
            url: 'http://site3.com',
            prebidInstances: [{}], // Tests handling of instance with no version/modules.
          },
        ]),
        'data2.json': JSON.stringify([
          {
            url: 'http://site4.com',
            prebidInstances: [
              {
                version: 'v9.10.0-pre',
                modules: [
                  'rubiconBidAdapter',
                  'pubCommonId',
                  'realTimeData',
                  'enrichmentRtdProvider',
                ],
              }, // `realTimeData` intended to be below threshold.
            ],
          },
          {
            url: 'http://site5.com',
            prebidInstances: [
              {
                version: 'v1.2.3-custom',
                modules: [
                  'rubiconBidAdapter',
                  'utiqSystem',
                  'customAnalyticsAdapter',
                ],
              },
            ],
          },
          {
            url: 'http://site6.com',
            prebidInstances: [
              {
                version: '9.35',
                modules: [
                  'rubiconBidAdapter',
                  'trustpidSystem',
                  'coreModuleOnly',
                ],
              },
            ],
          },
        ]),
      },
      Feb: {
        'data3.json': JSON.stringify([
          {
            url: 'http://site1.com', // Repeat site1
            prebidInstances: [
              {
                version: 'v8.2.0',
                modules: [
                  'rubiconBidAdapter',
                  'criteoIdSystem',
                  'appnexusBidAdapter',
                ],
              },
            ],
          },
          {
            url: 'http://site7.com', // No Prebid
          },
        ]),
      },
      Mar: {
        // Add more data to ensure some modules pass threshold
        'data4.json': JSON.stringify([
          {
            url: 'http://site8.com',
            prebidInstances: [
              {
                version: 'v8.2.0',
                modules: [
                  'rubiconBidAdapter',
                  'appnexusBidAdapter',
                  'criteoIdSystem',
                ],
              },
            ],
          },
          {
            url: 'http://site9.com',
            prebidInstances: [
              {
                version: 'v8.2.0',
                modules: [
                  'rubiconBidAdapter',
                  'appnexusBidAdapter',
                  'criteoIdSystem',
                ],
              },
            ],
          },
          {
            url: 'http://site10.com',
            prebidInstances: [
              {
                version: 'v8.2.0',
                modules: [
                  'rubiconBidAdapter',
                  'appnexusBidAdapter',
                  'criteoIdSystem',
                  'sharedIdSystem',
                ],
              },
            ],
          },
          {
            url: 'http://site11.com',
            prebidInstances: [
              {
                version: 'v8.2.0',
                modules: ['appnexusBidAdapter', 'sharedIdSystem'],
              },
            ],
          },
        ]),
      },
    },
    api: {}, // api directory must exist for writeFile to place api.json
  };

  it('should correctly summarize and clean stats, then write to api/api.json', async () => {
    // Copied mock data structure from the original test plan, adjusted for absolute storePath
    mockFs(mockComprehensiveData);

    await updateAndCleanStats();

    const outputPath = path.join('api', 'api.json');
    expect(fs.existsSync(outputPath)).toBe(true);
    const outputData = readMockJson(outputPath) as FinalApiData; // Cast here for type safety in helpers

    // Assertions from the original test plan
    assertSiteCounts(outputData, {
      visitedSites: 11,
      monitoredSites: 11,
      prebidSites: 10,
    });

    assertVersionCounts(outputData, {
      releaseVersions: { '8.2.0': 6, '8.1.0': 1, '7.53.0': 1 }, // Corrected
      buildVersions: { '9.10.0-pre': 1 },
      customVersions: { '1.2.3-custom': 1, '9.35': 1 }, // Corrected
    });
    // Removed: expect(outputData.customVersions['9.35']).toBeUndefined(); // Corrected

    // Module counts based on MIN_COUNT_THRESHOLD = 5 (threshold from update_stats.js)
    assertModuleInstanceCounts(outputData, {
      bidAdapterInst: { rubiconBidAdapter: 9, appnexusBidAdapter: 5 },
      idModuleInst: { criteoIdSystem: 6 },
      // analyticsAdapterInst, rtdModuleInst, otherModuleInst will be checked for absence of certain modules
    });

    // Assertions for modules that should be undefined (filtered out by threshold)
    expect(outputData.idModuleInst['sharedIdSystem']).toBeUndefined();
    expect(outputData.otherModuleInst['coreModuleOnly']).toBeUndefined();
    expect(outputData.rtdModuleInst['realTimeData']).toBeUndefined();
    expect(
      outputData.analyticsAdapterInst['adagioAnalyticsAdapter']
    ).toBeUndefined();
    expect(outputData.bidAdapterInst['nonExistentAdapter']).toBeUndefined();
    expect(outputData.otherModuleInst['belowThresholdModule']).toBeUndefined();

    // Website Counts (New Assertions)
    // MIN_COUNT_THRESHOLD = 5 also applies to website counts
    assertModuleWebsiteCounts(outputData, {
      bidAdapterWebsites: { rubiconBidAdapter: 8, appnexusBidAdapter: 5 },
      // idModuleWebsites, analyticsAdapterWebsites, rtdModuleWebsites, otherModuleWebsites will be checked for absence of certain modules
    });

    // Assertions for module website counts that should be undefined (filtered out by threshold)
    // criteoIdSystem is on 4 unique sites (site1, site8, site9, site10), below threshold of 5
    expect(outputData.idModuleWebsites['criteoIdSystem']).toBeUndefined();
    // sharedIdSystem is on 3 unique sites (site1, site10, site11), below threshold
    expect(outputData.idModuleWebsites['sharedIdSystem']).toBeUndefined();
    // coreModuleOnly is on 3 unique sites (site1, site2, site6), below threshold
    expect(outputData.otherModuleWebsites['coreModuleOnly']).toBeUndefined();
    // anotherModule is on 1 unique site (site1), below threshold
    expect(outputData.otherModuleWebsites['anotherModule']).toBeUndefined();

    // Check categories that should be empty based on current data
    expect(Object.keys(outputData.rtdModuleWebsites || {}).length).toBe(0);
    expect(Object.keys(outputData.analyticsAdapterWebsites || {}).length).toBe(
      0
    );
  });

  /**
   * @it Tests how `updateAndCleanStats` handles an empty 'store' directory.
   * This scenario simulates a situation where no data has been collected yet.
   * The function is expected to run without errors and produce an `api.json`
   * file with zero counts for all statistics.
   * @expectedOutcome An `api/api.json` file is created, and all statistical fields
   * (visitedSites, monitoredSites, prebidSites, version counts, module counts)
   * should be 0 or empty objects.
   */
  it('should handle empty store directory', async () => {
    // outputDir in update_stats.ts resolves to path.join(__dirname, '..', 'store')
    // where __dirname is /app/src/utils, so outputDir is /app/src/store
    // const storePath = path.resolve(process.cwd(), 'src', 'store'); // Now defined at the describe level
    mockFs({
      // Define mock structure for this specific test
      [storePath]: {}, // Mock the specific absolute path
      api: {}, // api directory must exist for writeFile to place api.json
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

  /**
   * @it Tests `updateAndCleanStats` with a 'store' directory containing empty month subdirectories.
   * This test checks if the function correctly handles month directories (e.g., 'Jan', 'Feb')
   * that exist but do not contain any data files.
   * @expectedOutcome The function should produce an `api/api.json` file with all
   * statistics initialized to zero, similar to the empty store directory scenario.
   * No errors should occur due to empty month directories.
   */
  it('should handle store directory with empty month directories', async () => {
    // const storePath = path.resolve(process.cwd(), 'src', 'store'); // Now defined at the describe level
    mockFs({
      [storePath]: {
        Jan: {}, // Empty month directory
        Feb: {}, // Another empty month directory
      },
      api: {},
    });

    // Removed incorrect console.log from here

    await updateAndCleanStats();
    const outputData = readMockJson(path.join('api', 'api.json'));
    expect(outputData.visitedSites).toBe(0);
    expect(outputData.monitoredSites).toBe(0);
    expect(outputData.prebidSites).toBe(0);
  });

  /**
   * @it Tests `updateAndCleanStats` with month directories containing non-JSON files.
   * This test ensures that the function only processes `.json` files and ignores
   * other file types (e.g., `.txt`) within the month directories.
   * @expectedOutcome An `api/api.json` file should be created with all statistics
   * counts as zero, as no valid JSON data files are present to be processed.
   * The presence of non-JSON files should not cause errors.
   */
  it('should handle store directory with month directories having no json files', async () => {
    // const storePath = path.resolve(process.cwd(), 'src', 'store'); // Now defined at the describe level
    mockFs({
      [storePath]: {
        Jan: { 'not-a-json.txt': 'hello' }, // Month directory with a non-JSON file
      },
      api: {},
    });
    await updateAndCleanStats();
    const outputData = readMockJson(path.join('api', 'api.json'));
    expect(outputData.visitedSites).toBe(0);
    expect(outputData.monitoredSites).toBe(0);
    expect(outputData.prebidSites).toBe(0);
  });
});
