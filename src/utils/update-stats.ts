import * as path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';
import {
  readDirectory,
  readJsonFile,
  ensureDirectoryExists,
  writeJsonFile,
} from './file-system-utils.js';
import type { Dirent } from 'fs';
import {
  processModuleDistribution,
  processModuleWebsiteCounts,
  processVersionDistribution,
  _processSiteEntries,
} from './stats-processing.js';

import type {
  SiteData, // Used by readJsonFile<SiteData[]> in readAndParseFiles
  VersionDistribution,
  ModuleDistribution,
  ProcessedVersionDistribution, // Return type of imported processVersionDistribution
  ProcessedModuleDistribution, // Return type of imported processModuleDistribution
  ProcessedModuleWebsiteCounts, // Return type of imported processModuleWebsiteCounts
} from './stats-processing.js';

import {
  OUTPUT_DIR,
  FINAL_API_FILE_PATH,
  MIN_COUNT_THRESHOLD,
  MONTH_ABBR_REGEX,
} from '../config/stats-config.js';

/**
 * Represents the final aggregated API data structure that is written to a JSON file.
 * This data summarizes Prebid.js usage statistics across all scanned websites.
 * @interface FinalApiData
 * @property {number} visitedSites
 * @property {number} monitoredSites
 * @property {number} prebidSites
 * @property {VersionDistribution} releaseVersions
 * @property {VersionDistribution} buildVersions
 * @property {VersionDistribution} customVersions
 * @property {ModuleDistribution} bidAdapterInst
 * @property {ModuleDistribution} idModuleInst
 * @property {ModuleDistribution} rtdModuleInst
 * @property {ModuleDistribution} analyticsAdapterInst
 * @property {ModuleDistribution} otherModuleInst
 * @property {ModuleDistribution} [bidAdapterWebsites]
 * @property {ModuleDistribution} [idModuleWebsites]
 * @property {ModuleDistribution} [rtdModuleWebsites]
 * @property {ModuleDistribution} [analyticsAdapterWebsites]
 * @property {ModuleDistribution} [otherModuleWebsites]
 */
interface FinalApiData {
  visitedSites: number;
  monitoredSites: number;
  prebidSites: number;
  releaseVersions: VersionDistribution;
  buildVersions: VersionDistribution;
  customVersions: VersionDistribution;
  bidAdapterInst: ModuleDistribution;
  idModuleInst: ModuleDistribution;
  rtdModuleInst: ModuleDistribution;
  analyticsAdapterInst: ModuleDistribution;
  otherModuleInst: ModuleDistribution;
  bidAdapterWebsites?: ModuleDistribution;
  idModuleWebsites?: ModuleDistribution;
  rtdModuleWebsites?: ModuleDistribution;
  analyticsAdapterWebsites?: ModuleDistribution;
  otherModuleWebsites?: ModuleDistribution;
}

/**
 * Defines the structure of data aggregated by {@link readAndParseFiles} from raw scan data files.
 * This raw aggregated data is then further processed by other functions.
 *
 * @typedef {object} ParsedScanData
 * @property {Set<string>} uniqueUrls
 * @property {Set<string>} urlsWithPrebid
 * @property {VersionDistribution} rawVersionCounts
 * @property {ModuleDistribution} rawModuleCounts
 * @property {{ [moduleName: string]: Set<string> }} moduleWebsiteData
 */
interface ParsedScanData {
  uniqueUrls: Set<string>;
  urlsWithPrebid: Set<string>;
  rawVersionCounts: VersionDistribution;
  rawModuleCounts: ModuleDistribution;
  moduleWebsiteData: { [moduleName: string]: Set<string> };
}

/**
 * Reads and parses all JSON scan data files from monthly subdirectories.
 * It aggregates data by calling the imported `_processSiteEntries` function.
 * File system operations are handled by utilities from `file-system-utils.js`.
 *
 * @async
 * @function readAndParseFiles
 * @param {string} baseOutputDir - The base directory for scan data.
 * @param {RegExp} monthDirRegex - Regex to identify month-named subdirectories.
 * @returns {Promise<ParsedScanData>} Aggregated raw data.
 */
async function readAndParseFiles(
  baseOutputDir: string,
  monthDirRegex: RegExp,
): Promise<ParsedScanData> {
  const rawVersionCounts: VersionDistribution = {};
  const rawModuleCounts: ModuleDistribution = {};
  const moduleWebsiteData: { [moduleName: string]: Set<string> } = {};
  const uniqueUrls: Set<string> = new Set();
  const urlsWithPrebid: Set<string> = new Set();

  try {
    // Use readDirectory from file-system-utils.js
    const outputEntries: Dirent[] = await readDirectory(baseOutputDir, {
      withFileTypes: true,
    });

    for (const entry of outputEntries) {
      if (entry.isDirectory() && monthDirRegex.test(entry.name)) {
        const monthDirPath: string = path.join(baseOutputDir, entry.name);
        try {
          // Use readDirectory from file-system-utils.js
          const files: string[] = await readDirectory(monthDirPath);

          for (const file of files) {
            if (path.extname(file).toLowerCase() === '.json') {
              const filePath: string = path.join(monthDirPath, file);
              try {
                // Use readJsonFile from file-system-utils.js
                const siteEntries: SiteData[] =
                  await readJsonFile<SiteData[]>(filePath);

                _processSiteEntries(
                  siteEntries,
                  filePath, // Pass filePath as source info
                  uniqueUrls,
                  urlsWithPrebid,
                  rawVersionCounts,
                  rawModuleCounts,
                  moduleWebsiteData,
                );
              } catch (parseError: any) {
                // Error logging for readJsonFile is handled within readJsonFile itself.
                // If readJsonFile throws, this catch block will handle it.
                logger.instance.warn(
                  `Skipping file due to parsing error: ${filePath}`,
                );
              }
            }
          }
        } catch (monthDirError: any) {
          // Error logging for readDirectory is handled within readDirectory itself.
          // If readDirectory throws, this catch block will handle it.
          logger.instance.warn(
            `Skipping directory due to reading error: ${monthDirPath}`,
          );
        }
      }
    }
  } catch (baseDirError: any) {
    // Error logging for readDirectory is handled within readDirectory itself.
    logger.instance.error(
      `Critical error reading base output directory ${baseOutputDir}. Further processing may be impacted.`,
      {
        errorName: baseDirError.name,
        errorMessage: baseDirError.message,
      },
    );
    // Rethrow or handle as critical if base directory processing is essential
    throw baseDirError;
  }

  return {
    uniqueUrls,
    urlsWithPrebid,
    rawVersionCounts,
    rawModuleCounts,
    moduleWebsiteData,
  };
}

/**
 * Main orchestration function to generate and update Prebid.js usage statistics.
 * This function serves as the primary entry point for the statistics generation process.
 *
 * Key steps:
 * 1.  **Read and Parse Data**: Uses {@link readAndParseFiles} to read all raw scan data from JSON files
 *     located in monthly subdirectories (e.g., `store/Jan`, `store/Feb`). This aggregates initial counts
 *     for URLs, Prebid versions, and modules.
 * 2.  **Process Version Distribution**: Calls {@link processVersionDistribution} to categorize the raw
 *     Prebid.js version counts into `releaseVersions`, `buildVersions`, and `customVersions`.
 *     Versions are sorted and cleaned (e.g., 'v' prefix removed).
 * 3.  **Process Module Instance Distribution**: Calls {@link processModuleDistribution} to categorize
 *     raw module instance counts (how many times each module appears in Prebid setups).
 *     Modules are filtered by `MIN_COUNT_THRESHOLD` and sorted by instance count.
 * 4.  **Process Module Website Distribution**: Calls {@link processModuleWebsiteCounts} to categorize
 *     modules based on the number of unique websites they appear on.
 *     Also filtered by `MIN_COUNT_THRESHOLD`.
 * 5.  **Compile Final Data**: Assembles all processed data into the {@link FinalApiData} structure.
 *     This includes total site counts, version distributions, and module distributions (both instance-based and website-based).
 * 6.  **Write to File**: Writes the `FinalApiData` object as a formatted JSON string to the
 *     `api/api.json` file, specified by {@link finalApiFilePath}. Ensures the target directory exists.
 *
 * @async
 * @function updateAndCleanStats
 * @returns {Promise<void>} A promise that resolves when the statistics generation is complete and the
 *          `api/api.json` file has been successfully written. The promise may reject if critical
 *          errors occur during file I/O that are not handled internally by `readAndParseFiles`.
 * @remarks
 * - This function uses constants imported from `stats-config.js` (e.g., `OUTPUT_DIR`, `FINAL_API_FILE_PATH`, `MIN_COUNT_THRESHOLD`).
 * - Errors encountered during the process (especially file operations or data processing steps)
 *   are logged using the configured `logger` instance.
 * - The output JSON file (`api/api.json`) is intended for consumption by an API, dashboard, or for direct analysis
 *   to understand Prebid.js adoption trends.
 */
async function updateAndCleanStats(): Promise<void> {
  try {
    // Step 1: Read and parse raw data from scan files
    const parsedData: ParsedScanData = await readAndParseFiles(
      OUTPUT_DIR,
      MONTH_ABBR_REGEX,
    );

    // Step 2: Process and categorize version distributions
    const versionStats: ProcessedVersionDistribution =
      processVersionDistribution(parsedData.rawVersionCounts);

    // Step 3: Process and categorize module instance distributions
    const moduleInstanceStats = processModuleDistribution(
      parsedData.rawModuleCounts,
      MIN_COUNT_THRESHOLD,
    );

    // Step 4: Process and categorize module website distributions
    const moduleWebsiteStats = processModuleWebsiteCounts(
      parsedData.moduleWebsiteData,
      MIN_COUNT_THRESHOLD,
    );

    // Step 5: Compile all processed data into the final API structure
    const finalApiData: FinalApiData = {
      visitedSites: parsedData.uniqueUrls.size,
      monitoredSites: parsedData.uniqueUrls.size, // Assuming all visited sites are monitored for this context
      prebidSites: parsedData.urlsWithPrebid.size,
      releaseVersions: versionStats.releaseVersions,
      buildVersions: versionStats.buildVersions,
      customVersions: versionStats.customVersions,
      bidAdapterInst: moduleInstanceStats.bidAdapterInst,
      idModuleInst: moduleInstanceStats.idModuleInst,
      rtdModuleInst: moduleInstanceStats.rtdModuleInst,
      analyticsAdapterInst: moduleInstanceStats.analyticsAdapterInst,
      otherModuleInst: moduleInstanceStats.otherModuleInst,
      bidAdapterWebsites: moduleWebsiteStats.bidAdapterWebsites,
      idModuleWebsites: moduleWebsiteStats.idModuleWebsites,
      rtdModuleWebsites: moduleWebsiteStats.rtdModuleWebsites,
      analyticsAdapterWebsites: moduleWebsiteStats.analyticsAdapterWebsites,
      otherModuleWebsites: moduleWebsiteStats.otherModuleWebsites,
    };

    // Step 6: Write the final data to api.json
    const targetApiDir: string = path.dirname(FINAL_API_FILE_PATH);
    await ensureDirectoryExists(targetApiDir);

    // Use writeJsonFile from file-system-utils.js
    await writeJsonFile(FINAL_API_FILE_PATH, finalApiData);
    logger.instance.info(
      `Successfully updated statistics at ${FINAL_API_FILE_PATH}`,
    );
  } catch (err: any) {
    // Catch errors from readAndParseFiles if rethrown, or from processing steps,
    // or from ensureDirectoryExists/writeJsonFile if they rethrow.
    logger.instance.error('A critical error occurred in updateAndCleanStats:', {
      errorName: err.name,
      errorMessage: err.message,
      stack: err.stack,
    });
    // Depending on application design, might rethrow or exit process
    throw err;
  }
}

// Export necessary functions for use elsewhere.
export {
  updateAndCleanStats,
  readAndParseFiles,
};
export type {
  FinalApiData,
  ParsedScanData,
  VersionDistribution, // Re-exported from stats-processing
  ModuleDistribution, // Re-exported from stats-processing
};
