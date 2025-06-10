/**
 * @fileoverview This module is responsible for handling the outcomes of page processing tasks.
 * It includes functions for logging different task results (success, no data, error),
 * aggregating successful data, writing these results to JSON files in an organized
 * directory structure, and updating input files (e.g., removing successfully processed URLs).
 */

import * as fs from 'fs';
import * as path from 'path'; // Import path module for robust file path operations
import type { Logger as WinstonLogger } from 'winston';
// Import shared types from the new common location
import type { TaskResult, PageData } from '../common/types.js';

/**
 * Processes an array of {@link TaskResult} objects. It logs the outcome of each task
 * (success, no data, or error) using the provided logger and aggregates all {@link PageData}
 * from tasks that were successfully processed.
 *
 * For tasks of type 'error', it logs the structured {@link ErrorDetails} including
 * `code`, `message`, and potentially `stack`.
 *
 * @param {TaskResult[]} taskResults - An array of task results. Each element is an object
 *                                     conforming to the `TaskResult` discriminated union
 *                                     (i.e., {@link TaskResultSuccess}, {@link TaskResultNoData}, or {@link TaskResultError}).
 * @param {WinstonLogger} logger - An instance of WinstonLogger for logging messages.
 * @returns {PageData[]} An array containing only the `PageData` objects from successful tasks.
 *                       Returns an empty array if no tasks were successful or if the input `taskResults` is empty.
 * @example
 * const results = [
 *   { type: 'success', data: { url: 'https://a.com', libraries: ['libA'], date: '2023-01-01', prebidInstances: [] } },
 *   { type: 'no_data', url: 'https://b.com' },
 *   { type: 'error', url: 'https://c.com', error: { code: 'TIMEOUT', message: 'Page timed out' } }
 * ];
 * const successfulData = processAndLogTaskResults(results, logger);
 * // successfulData would be [{ url: 'https://a.com', libraries: ['libA'], date: '2023-01-01', prebidInstances: [] }]
 * // The logger would have recorded:
 * // - An info message for 'https://a.com'.
 * // - A warning for 'https://b.com'.
 * // - An error message for 'https://c.com', including its error code and message.
 */
export function processAndLogTaskResults(
  taskResults: TaskResult[],
  logger: WinstonLogger
): PageData[] {
  const successfulResults: PageData[] = [];
  if (!taskResults || taskResults.length === 0) {
    logger.info('No task results to process.');
    return successfulResults;
  }

  logger.info(`Processing ${taskResults.length} task results...`);
  for (const taskResult of taskResults) {
    if (!taskResult) {
      logger.warn(
        `A task returned no result or an undefined entry in taskResults. This should ideally not happen.`
      );
      continue;
    }

    // Use type property to discriminate and log accordingly
    const { type } = taskResult;
    switch (type) {
      case 'success':
        logger.info(`SUCCESS: Data extracted for ${taskResult.data.url}`, {
          url: taskResult.data.url,
          version: taskResult.data.prebidInstances?.[0]?.version, // Log first Prebid instance version if available
        });
        successfulResults.push(taskResult.data);
        break;
      case 'no_data':
        logger.warn(
          `NO_DATA: No relevant ad tech data found for ${taskResult.url}`,
          { url: taskResult.url }
        );
        break;
      case 'error':
        // Log structured error details
        logger.error(
          `ERROR: Processing failed for ${taskResult.url} - Code: ${taskResult.error.code}, Msg: ${taskResult.error.message}`,
          { url: taskResult.url, errorDetails: taskResult.error } // errorDetails will contain code, message, and stack
        );
        break;
      default:
        // This path should ideally be unreachable if 'type' is always a valid TaskResultType.
        const exhaustiveCheck: never = type; // TypeScript will error here if any TaskResultType is unhandled
        logger.warn(
          `Unknown task result type encountered: '${exhaustiveCheck}'`,
          { result: taskResult }
        );
    }
  }
  logger.info(
    `Finished processing task results. ${successfulResults.length} successful extractions.`
  );
  return successfulResults;
}

/**
 * Writes an array of {@link PageData} objects to a JSON file.
 * The file is organized into a directory structure: `baseOutputDir/Mmm-YYYY/YYYY-MM-DD.json`.
 * For example, results for April 2nd, 2025, would be in `baseOutputDir/Apr-2025/2025-04-02.json`.
 * If the target directory (including the month-year subdirectory) does not exist, it will be created.
 *
 * If a file for the current day already exists and contains a valid JSON array, new results are appended to it.
 * Otherwise, a new file is created, or an existing file with invalid content (not a JSON array) is overwritten.
 *
 * @param {PageData[]} resultsToSave - An array of `PageData` objects to be written.
 *                                     If empty or undefined, the function logs this and returns without writing.
 * @param {string} baseOutputDir - The root directory for the dated subdirectories and result files (e.g., "store").
 * @param {WinstonLogger} logger - An instance of WinstonLogger for logging messages.
 * @example
 * const exampleData = [{ url: 'https://example.com', libraries: ['libX'], date: '2025-04-02', prebidInstances: [] }];
 * // Assuming 'baseOutputDir' is 'store' and current date is April 2nd, 2025:
 * writeResultsToFile(exampleData, "store", logger);
 * // This would create or append to: store/Apr-2025/2025-04-02.json
 */
export function writeResultsToFile(
  resultsToSave: PageData[],
  baseOutputDir: string,
  logger: WinstonLogger
): void {
  if (!resultsToSave || resultsToSave.length === 0) {
    logger.info('No results to save to file.');
    return;
  }

  try {
    const now = new Date();
    const year = now.getFullYear().toString();
    const monthPadded = String(now.getMonth() + 1).padStart(2, '0'); // Ensure two digits for month
    const monthShort = now.toLocaleString('default', { month: 'short' }); // e.g., "Jan", "Feb"
    const dayPadded = String(now.getDate()).padStart(2, '0'); // Ensure two digits for day

    // Create a month-year directory, e.g., "Apr-2025"
    const monthDir = path.join(baseOutputDir, `${monthShort}-${year}`);
    if (!fs.existsSync(monthDir)) {
      fs.mkdirSync(monthDir, { recursive: true }); // Create directory recursively if it doesn't exist
      logger.info(`Created output directory: ${monthDir}`);
    }

    const dateFilename = `${year}-${monthPadded}-${dayPadded}.json`;
    const filePath = path.join(monthDir, dateFilename);

    if (fs.existsSync(filePath)) {
      let existingData: PageData[] = [];
      try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        existingData = JSON.parse(fileContent);
        if (!Array.isArray(existingData)) {
          logger.warn(
            `Existing file ${filePath} does not contain a valid JSON array. Overwriting.`
          );
          existingData = [];
        }
      } catch (parseError: any) {
        logger.warn(
          `Error parsing existing file ${filePath}. Overwriting. Error: ${parseError.message}`
        );
        existingData = [];
      }
      const combinedData = existingData.concat(resultsToSave);
      const jsonOutput = JSON.stringify(combinedData, null, 2);
      fs.writeFileSync(filePath, jsonOutput + '\n', 'utf8'); // Add newline for POSIX compatibility
      logger.info(
        `Successfully appended ${resultsToSave.length} results to ${filePath}. Total results: ${combinedData.length}`
      );
    } else {
      const jsonOutput = JSON.stringify(resultsToSave, null, 2); // Pretty print JSON
      fs.writeFileSync(filePath, jsonOutput + '\n', 'utf8'); // Add newline for POSIX compatibility
      logger.info(
        `Successfully wrote ${resultsToSave.length} new results to ${filePath}`
      );
    }
  } catch (e: unknown) {
    const err = e as Error; // Cast to Error for standard properties
    logger.error('Failed to write results to file system.', {
      errorName: err.name,
      errorMessage: err.message,
      stack: err.stack, // Include stack trace for debugging
    });
    // Note: This function currently does not re-throw the error.
    // The caller (e.g., prebidExplorer) will continue, potentially without saved results for this batch.
  }
}

/**
 * Updates a specified input file (expected to be a `.txt` file containing a list of URLs, one per line)
 * by removing URLs that were successfully processed in the current run.
 *
 * The logic is as follows:
 * 1. Reads all URLs from the existing `inputFilepath`.
 * 2. Identifies successfully processed URLs from the `taskResults`.
 * 3. Filters the original list of URLs:
 *    - URLs not part of the `urlsInCurrentProcessingScope` are always kept (preserved).
 *    - URLs that were part of `urlsInCurrentProcessingScope` are kept only if they were *not* successfully processed.
 * 4. The resulting list of URLs (those to be kept/retried) is written back to `inputFilepath`, overwriting it.
 *
 * If `inputFilepath` does not exist, a warning is logged, and a new file is created containing only
 * the URLs from `urlsInCurrentProcessingScope` that were not successfully processed.
 * If `inputFilepath` is not a `.txt` file, the operation is skipped.
 *
 * @param {string} inputFilepath - The path to the input file (e.g., "urls_to_scan.txt").
 * @param {string[]} urlsInCurrentProcessingScope - An array of all URLs that were candidates for processing
 *                                                  in the current execution batch (e.g., after applying range or chunking filters).
 * @param {TaskResult[]} taskResults - An array of {@link TaskResult} objects representing the outcomes
 *                                     for the URLs that were attempted in the current scope.
 * @param {WinstonLogger} logger - An instance of WinstonLogger for logging messages.
 * @example
 * // Assume "pending.txt" originally contains:
 * // https://a.com
 * // https://b.com
 * // https://c.com
 * // https://d.com (this one was not in current scope for this example run)
 *
 * const currentScopeForRun = ["https://a.com", "https://b.com", "https://c.com"];
 * const outcomesForRun = [
 *   { type: 'success', data: { url: 'https://a.com', ... } },
 *   { type: 'error', url: 'https://b.com', error: { code: 'TIMEOUT', message: 'Page timed out' } },
 *   { type: 'success', data: { url: 'https://c.com', ... } }
 * ];
 *
 * updateInputFile("pending.txt", currentScopeForRun, outcomesForRun, logger);
 *
 * // "pending.txt" will be updated to contain:
 * // https://b.com  (kept because it was in scope but failed)
 * // https://d.com  (kept because it was not in the current processing scope)
 */
export function updateInputFile(
  inputFilepath: string,
  urlsInCurrentProcessingScope: string[],
  taskResults: TaskResult[],
  logger: WinstonLogger
): void {
  if (!inputFilepath.endsWith('.txt')) {
    logger.info(
      `Skipping modification of input file as it is not a .txt file: ${inputFilepath}`
    );
    return;
  }

  try {
    const successfullyProcessedUrlsInScope = new Set<string>();
    for (const taskResult of taskResults) {
      // Only consider successful results for URLs that were actually part of the current scope
      if (
        taskResult &&
        taskResult.type === 'success' &&
        taskResult.data.url &&
        urlsInCurrentProcessingScope.includes(taskResult.data.url)
      ) {
        successfullyProcessedUrlsInScope.add(taskResult.data.url);
      }
    }

    let finalUrlsToWrite: string[];

    if (fs.existsSync(inputFilepath)) {
      const originalContent = fs.readFileSync(inputFilepath, 'utf8');
      const originalUrls = originalContent
        .split('\n')
        .map((line) => line.trim()) // Trim each line
        .filter((line) => line !== ''); // Filter out empty lines after trimming

      const currentScopeSet = new Set(
        urlsInCurrentProcessingScope.map((url) => url.trim())
      );

      finalUrlsToWrite = originalUrls.filter((url) => {
        const trimmedUrl = url.trim(); // Ensure comparison is with trimmed URLs
        if (currentScopeSet.has(trimmedUrl)) {
          // If URL was in current scope, keep it only if it was NOT successfully processed
          return !successfullyProcessedUrlsInScope.has(trimmedUrl);
        }
        return true; // Keep if not in current scope (preserve other URLs)
      });
    } else {
      // If the input file doesn't exist, new file will contain only unsuccessful URLs from current scope
      logger.warn(
        `Input file ${inputFilepath} not found for updating. Will create it with remaining (unsuccessful or unprocessed) URLs from current scope.`
      );
      finalUrlsToWrite = urlsInCurrentProcessingScope.filter(
        (url: string) => !successfullyProcessedUrlsInScope.has(url.trim())
      );
    }

    fs.writeFileSync(
      inputFilepath,
      finalUrlsToWrite.join('\n') + (finalUrlsToWrite.length > 0 ? '\n' : ''), // Add trailing newline if not empty
      'utf8'
    );
    logger.info(
      `${inputFilepath} updated. ${successfullyProcessedUrlsInScope.size} URLs from current scope successfully processed and removed. ${finalUrlsToWrite.length} URLs remain or were added.`
    );
  } catch (e: unknown) {
    const writeError = e as Error;
    logger.error(`Failed to update ${inputFilepath}: ${writeError.message}`, {
      stack: writeError.stack,
    });
  }
}

/**
 * Appends a URL to a specified error file based on the type of error encountered.
 * Error files are simple text files with one URL per line.
 *
 * - If the `baseErrorDir` does not exist, it will be created recursively.
 * - The filename is determined by `errorType`:
 *   - 'no_prebid': "no_prebid.txt"
 *   - 'navigation_error': "navigation_errors.txt"
 *   - 'processing_error': "error_processing.txt"
 *
 * @param {string} url - The URL to write to the error file.
 * @param {'no_prebid' | 'navigation_error' | 'processing_error'} errorType - The category of error, determining the target file.
 * @param {string} url - The URL to log to the error file.
 * @param {'no_prebid' | 'navigation_error' | 'processing_error'} errorType - The category of error, which dictates the filename.
 * @param {string} baseErrorDir - The base directory where error files will be stored (e.g., "errors").
 *                                This directory will be created if it doesn't exist.
 * @param {WinstonLogger} logger - An instance of WinstonLogger for logging messages.
 * @example
 * // To log a URL that had a navigation issue:
 * writeErrorUrlToFile("https://example.com/timed_out", "navigation_error", "errors", logger);
 * // This appends "https://example.com/timed_out" to the "errors/navigation_errors.txt" file.
 *
 * // To log a URL where no Prebid.js was found:
 * writeErrorUrlToFile("https://example.com/no_prebid_here", "no_prebid", "errors", logger);
 * // This appends "https://example.com/no_prebid_here" to the "errors/no_prebid.txt" file.
 */
export function writeErrorUrlToFile(
  url: string,
  errorType: 'no_prebid' | 'navigation_error' | 'processing_error',
  baseErrorDir: string,
  logger: WinstonLogger
): void {
  let filename: string;
  switch (errorType) {
    case 'no_prebid':
      filename = 'no_prebid.txt';
      break;
    case 'navigation_error':
      filename = 'navigation_errors.txt';
      break;
    case 'processing_error':
      filename = 'error_processing.txt';
      break;
    default:
      // Should be unreachable if errorType is correctly typed
      logger.error(
        `Invalid errorType provided: ${errorType}. Cannot write URL to error file.`
      );
      return;
  }

  const filePath = path.join(baseErrorDir, filename);

  try {
    if (!fs.existsSync(baseErrorDir)) {
      fs.mkdirSync(baseErrorDir, { recursive: true });
      logger.info(`Created error directory: ${baseErrorDir}`);
    }

    fs.appendFileSync(filePath, url + '\n', 'utf8');
    logger.info(`Appended URL ${url} to ${filePath}`);
  } catch (error: any) {
    logger.error(
      `Failed to append URL ${url} to ${filePath}: ${error.message}`,
      {
        stack: error.stack,
      }
    );
  }
}
