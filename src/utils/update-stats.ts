import * as path from 'path';
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
} from './stats-processing.js';

import {
  OUTPUT_DIR,
  FINAL_API_FILE_PATH,
  MIN_COUNT_THRESHOLD,
  MONTH_ABBR_REGEX,
} from '../config/stats-config.js';
import { AppError, AppErrorDetails } from './../common/AppError.js';

/**
 * Represents the final aggregated API data structure that is written to a JSON file.
 * This data summarizes Prebid.js usage statistics across all scanned websites,
 * including counts of sites, version distributions, and module usage.
 *
 * @interface FinalApiData
 * @property {number} visitedSites - Total number of unique URLs visited during scans.
 * @property {number} monitoredSites - Total number of unique URLs considered for monitoring (currently same as visitedSites).
 * @property {number} prebidSites - Total number of unique URLs where Prebid.js was detected.
 * @property {VersionDistribution} releaseVersions - Distribution of official release Prebid.js versions.
 * @property {VersionDistribution} buildVersions - Distribution of Prebid.js build versions (e.g., "-pre" suffix).
 * @property {VersionDistribution} customVersions - Distribution of custom or non-standard Prebid.js versions.
 * @property {ModuleDistribution} bidAdapterInst - Distribution of bid adapter modules by instance count.
 * @property {ModuleDistribution} idModuleInst - Distribution of ID system modules by instance count.
 * @property {ModuleDistribution} rtdModuleInst - Distribution of Real-Time Data (RTD) modules by instance count.
 * @property {ModuleDistribution} analyticsAdapterInst - Distribution of analytics adapter modules by instance count.
 * @property {ModuleDistribution} otherModuleInst - Distribution of other modules by instance count.
 * @property {ModuleDistribution} [bidAdapterWebsites] - Optional. Distribution of bid adapter modules by unique website count.
 * @property {ModuleDistribution} [idModuleWebsites] - Optional. Distribution of ID system modules by unique website count.
 * @property {ModuleDistribution} [rtdModuleWebsites] - Optional. Distribution of RTD modules by unique website count.
 * @property {ModuleDistribution} [analyticsAdapterWebsites] - Optional. Distribution of analytics adapter modules by unique website count.
 * @property {ModuleDistribution} [otherModuleWebsites] - Optional. Distribution of other modules by unique website count.
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
 * This raw aggregated data serves as an intermediate step before further processing and categorization.
 *
 * @interface ParsedScanData
 * @property {Set<string>} uniqueUrls - A set of all unique URLs encountered during scans.
 * @property {Set<string>} urlsWithPrebid - A set of unique URLs where Prebid.js was detected.
 * @property {VersionDistribution} rawVersionCounts - An aggregation of Prebid.js version counts as found in scan data.
 * @property {ModuleDistribution} rawModuleCounts - An aggregation of Prebid.js module instance counts.
 * @property {{ [moduleName: string]: Set<string> }} moduleWebsiteData - A map where keys are module names and values are Sets of unique website URLs using that module.
 */
interface ParsedScanData {
  uniqueUrls: Set<string>;
  urlsWithPrebid: Set<string>;
  rawVersionCounts: VersionDistribution;
  rawModuleCounts: ModuleDistribution;
  moduleWebsiteData: { [moduleName: string]: Set<string> };
}

/**
 * Reads and parses all JSON scan data files from monthly subdirectories within the `baseOutputDir`.
 * It identifies directories matching the `monthDirRegex` (e.g., "YYYY-MM-Mon"), then reads all `.json`
 * files within them. Data from these files is aggregated using `_processSiteEntries`.
 * File system operations like reading directories and JSON files are delegated to utilities
 * from `file-system-utils.js`, which may throw `AppError` for FS issues.
 *
 * @async
 * @function readAndParseFiles
 * @param {string} baseOutputDir - The base directory where scan data (organized into monthly subdirectories) is stored.
 * @param {RegExp} monthDirRegex - A regular expression used to identify month-named subdirectories.
 * @returns {Promise<ParsedScanData>} A promise that resolves to an object containing aggregated raw data:
 *                                   unique URLs, URLs with Prebid, raw version counts, raw module counts,
 *                                   and module-to-website mappings.
 * @throws {AppError} If reading the base output directory (`baseOutputDir`) fails (errorCode: `FS_READDIR_FAILED` from `readDirectory`).
 * @throws {AppError} If reading a month directory fails (errorCode: `FS_READDIR_FAILED` from `readDirectory`).
 * @throws {AppError} If reading or parsing a JSON file fails (errorCodes: `FS_READFILE_FAILED` or `JSON_PARSE_FAILED` from `readJsonFile`).
 *                    These errors are logged, and the specific file/directory is skipped, but an error reading the base directory will propagate.
 *                    A new AppError with `errorCode: 'STATS_DATA_READ_ERROR'` is thrown if any critical error occurs during this process.
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
    const outputEntries: Dirent[] = await readDirectory(baseOutputDir, {
      withFileTypes: true,
    });

    for (const entry of outputEntries) {
      if (entry.isDirectory() && monthDirRegex.test(entry.name)) {
        const monthDirPath: string = path.join(baseOutputDir, entry.name);
        try {
          const files: string[] = await readDirectory(monthDirPath);

          for (const file of files) {
            if (path.extname(file).toLowerCase() === '.json') {
              const filePath: string = path.join(monthDirPath, file);
              try {
                const siteEntries: SiteData[] =
                  await readJsonFile<SiteData[]>(filePath);

                _processSiteEntries(
                  siteEntries,
                  filePath,
                  uniqueUrls,
                  urlsWithPrebid,
                  rawVersionCounts,
                  rawModuleCounts,
                  moduleWebsiteData,
                );
              } catch (parseOrReadFileError) {
                // Errors from readJsonFile are AppErrors
                logger.instance.warn(
                  `Skipping file due to error: ${filePath}. Error: ${(parseOrReadFileError as Error).message}`,
                  { details: (parseOrReadFileError as AppError).details },
                );
              }
            }
          }
        } catch (monthDirReadError) {
          // Errors from readDirectory are AppErrors
          logger.instance.warn(
            `Skipping directory due to reading error: ${monthDirPath}. Error: ${(monthDirReadError as Error).message}`,
            { details: (monthDirReadError as AppError).details },
          );
        }
      }
    }
  } catch (baseDirError: unknown) {
    // Could be AppError from readDirectory or other fs error
    const err = baseDirError as Error;
    logger.instance.error(
      `Critical error reading base output directory ${baseOutputDir}. Further processing may be impacted.`,
      {
        errorName: err.name,
        errorMessage: err.message,
        details: err instanceof AppError ? err.details : undefined,
      },
    );
    const errorDetails: AppErrorDetails = {
      errorCode: 'STATS_DATA_READ_ERROR',
      originalError: err,
      baseOutputDir,
    };
    throw new AppError(
      `Failed to read or parse stats data from ${baseOutputDir}: ${err.message}`,
      errorDetails,
    );
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
 *     `api/api.json` file, specified by {@link FINAL_API_FILE_PATH}. Ensures the target directory exists using {@link ensureDirectoryExists}.
 *
 * @async
 * @function updateAndCleanStats
 * @returns {Promise<void>} A promise that resolves when the statistics generation is complete and the
 *          `api/api.json` file has been successfully written.
 * @throws {AppError} Propagates `AppError` if critical errors occur during file I/O (e.g., from `readAndParseFiles`,
 *                    `ensureDirectoryExists`, or `writeJsonFile`), or if other unexpected errors occur during processing.
 *                    Specific errorCodes might include `STATS_DATA_READ_ERROR`, `FS_MKDIR_FAILED`, `FS_WRITEFILE_FAILED`.
 * @remarks
 * - This function uses constants imported from `stats-config.js` (e.g., `OUTPUT_DIR`, `FINAL_API_FILE_PATH`, `MIN_COUNT_THRESHOLD`).
 * - Errors encountered during the process are logged using the configured `logger` instance.
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
    await ensureDirectoryExists(targetApiDir); // This can throw AppError (FS_MKDIR_FAILED)

    // Use writeJsonFile from file-system-utils.js
    await writeJsonFile(FINAL_API_FILE_PATH, finalApiData); // This can throw AppError (FS_WRITEFILE_FAILED)
    logger.instance.info(
      `Successfully updated statistics at ${FINAL_API_FILE_PATH}`,
    );
  } catch (err: unknown) {
    // Catch errors from readAndParseFiles, ensureDirectoryExists, writeJsonFile, or other processing steps.
    if (err instanceof AppError) {
      // If it's already an AppError, log its details
      logger.instance.error(
        `A critical error occurred in updateAndCleanStats: ${err.message}`,
        {
          errorName: err.name,
          errorCode: err.details?.errorCode,
          originalErrorMsg: err.details?.originalError?.message,
          stack: err.stack,
          details: err.details,
        },
      );
    } else if (err instanceof Error) {
      // For other native errors
      logger.instance.error(
        'A critical error occurred in updateAndCleanStats:',
        {
          errorName: err.name,
          errorMessage: err.message,
          stack: err.stack,
        },
      );
    } else {
      // For unknown throw types
      logger.instance.error(
        'A critical and unknown error occurred in updateAndCleanStats.',
        { error: err },
      );
    }
    // Rethrow to be handled by the calling command (e.g., stats/generate.ts)
    // The calling command is expected to format it for the user.
    throw err;
  }
}

// Export necessary functions for use elsewhere.
export { updateAndCleanStats, readAndParseFiles };
export type {
  FinalApiData,
  ParsedScanData,
  VersionDistribution, // Re-exported from stats-processing
  ModuleDistribution, // Re-exported from stats-processing
};
