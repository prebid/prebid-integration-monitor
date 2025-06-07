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
 * Iterates through an array of {@link TaskResult} objects, logs details for each outcome,
 * and collects all {@link PageData} from tasks that were successful.
 *
 * @param {TaskResult[]} taskResults - An array of task results, where each element is an object
 *                                     conforming to the `TaskResult` discriminated union.
 * @param {WinstonLogger} logger - An instance of WinstonLogger for logging messages.
 * @returns {PageData[]} An array containing only the `PageData` objects from `TaskResultSuccess` outcomes.
 *                       Returns an empty array if no tasks were successful or if the input is empty.
 * @example
 * const results = [
 *   { type: 'success', data: { url: 'https://a.com', libraries: ['libA'], date: '2023-01-01' } },
 *   { type: 'no_data', url: 'https://b.com' },
 *   { type: 'error', url: 'https://c.com', error: 'TIMEOUT' }
 * ];
 * const successfulData = processAndLogTaskResults(results, logger);
 * // successfulData would be [{ url: 'https://a.com', libraries: ['libA'], date: '2023-01-01' }]
 * // logger would have logged info for a.com, warn for b.com, and error for c.com
 */
export function processAndLogTaskResults(
  taskResults: TaskResult[],
  logger: WinstonLogger,
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
        `A task returned no result or an undefined entry in taskResults. This should ideally not happen.`,
      );
      continue;
    }
    // Note: The first check for !taskResult is sufficient.
    // The second identical check has been removed.

    // Use type property to discriminate and log accordingly
    const { type } = taskResult;
    switch (type) {
      case 'success':
        // Type guard ensures taskResult is TaskResultSuccess here
        logger.info(`SUCCESS: Data extracted for ${taskResult.data.url}`, {
          url: taskResult.data.url,
          version: taskResult.data.prebidInstances?.[0]?.version,
        });
        successfulResults.push(taskResult.data);
        break;
      case 'no_data':
        // Type guard ensures taskResult is TaskResultNoData here
        logger.warn(
          `NO_DATA: No relevant ad tech data found for ${taskResult.url}`,
          { url: taskResult.url },
        );
        break;
      case 'error':
        // Type guard ensures taskResult is TaskResultError here
        logger.error(
          `ERROR: Processing failed for ${taskResult.url} - ${taskResult.error}`,
          { url: taskResult.url, errorDetails: taskResult.error },
        );
        break;
      default:
        // This path should ideally be unreachable if 'type' is always a valid TaskResultType.
        // The 'never' type helps enforce this at compile time.
        const exhaustiveCheck: never = type;
        logger.warn(
          `Unknown task result type encountered: '${exhaustiveCheck}'`,
          { result: taskResult },
        );
    }
  }
  logger.info(
    `Finished processing task results. ${successfulResults.length} successful extractions.`,
  );
  return successfulResults;
}

/**
 * Writes an array of {@link PageData} objects to a JSON file.
 * The file is organized into a directory structure based on the current year and month,
 * and the filename includes the current date.
 * Example: `<outputDir>/<YYYY-MM-Mon>/<YYYY-MM-DD>.json`
 *
 * @param {PageData[]} resultsToSave - An array of `PageData` objects to be written to the file.
 * @param {string} baseOutputDir - The root directory where the dated subdirectories and result files will be created.
 * @param {WinstonLogger} logger - An instance of WinstonLogger for logging messages.
 * @example
 * const dataToSave = [{ url: 'https://a.com', libraries: [], date: '2023-01-01'}];
 * writeResultsToFile(dataToSave, "/app/output", logger);
 * // This might create a file like /app/output/2023-01-Jan/2023-01-15.json
 */
export function writeResultsToFile(
  resultsToSave: PageData[],
  baseOutputDir: string,
  logger: WinstonLogger,
): void {
  if (!resultsToSave || resultsToSave.length === 0) {
    logger.info('No results to save to file.');
    return;
  }

  try {
    const now = new Date();
    const year = now.getFullYear().toString();
    const monthPadded = String(now.getMonth() + 1).padStart(2, '0');
    const monthShort = now.toLocaleString('default', { month: 'short' }); // e.g., "Jan", "Feb"
    const dayPadded = String(now.getDate()).padStart(2, '0');

    // Create a year-month directory, e.g., "2023-01-Jan"
    const monthDir = path.join(
      baseOutputDir,
      `${year}-${monthPadded}-${monthShort}`,
    );
    if (!fs.existsSync(monthDir)) {
      fs.mkdirSync(monthDir, { recursive: true });
      logger.info(`Created output directory: ${monthDir}`);
    }

    const dateFilename = `${year}-${monthPadded}-${dayPadded}.json`;
    const filePath = path.join(monthDir, dateFilename);

    const jsonOutput = JSON.stringify(resultsToSave, null, 2);
    fs.writeFileSync(filePath, jsonOutput + '\n', 'utf8'); // Add newline for POSIX compatibility
    logger.info(
      `Successfully wrote ${resultsToSave.length} results to ${filePath}`,
    );
  } catch (e: unknown) {
    const err = e as Error;
    logger.error('Failed to write results to file system.', {
      errorName: err.name,
      errorMessage: err.message,
      stack: err.stack,
    });
  }
}

/**
 * Updates a specified input file (typically a `.txt` file containing a list of URLs)
 * by removing URLs that were successfully processed in the current run.
 * If the input file does not exist, it will be created with the URLs that were
 * attempted but not successfully processed from the current scope.
 *
 * @param {string} inputFilepath - The path to the input file (e.g., "urls_to_scan.txt").
 * @param {string[]} urlsInCurrentProcessingScope - An array of all URLs that were candidates for processing
 *                                                  in the current execution batch (after any range or chunking).
 * @param {TaskResult[]} taskResults - An array of {@link TaskResult} objects representing the outcomes
 *                                             for the URLs in `urlsInCurrentProcessingScope`.
 * @param {WinstonLogger} logger - An instance of WinstonLogger for logging messages.
 * @example
 * // Assume inputFile ("pending.txt") contains:
 * // https://a.com
 * // https://b.com
 * // https://c.com
 * // https://d.com (this one was not in current scope)
 * const currentScope = ["https://a.com", "https://b.com", "https://c.com"];
 * const outcomes = [
 *   { type: 'success', data: { url: 'https://a.com', ... } },
 *   { type: 'error', url: 'https://b.com', error: 'TIMEOUT' },
 *   { type: 'success', data: { url: 'https://c.com', ... } }
 * ];
 * updateInputFile("pending.txt", currentScope, outcomes, logger);
 * // "pending.txt" will be updated to:
 * // https://b.com
 * // https://d.com
 */
export function updateInputFile(
  inputFilepath: string,
  urlsInCurrentProcessingScope: string[], // Should be all URLs that were *candidates* for processing in this run
  taskResults: TaskResult[],
  logger: WinstonLogger,
): void {
  if (!inputFilepath.endsWith('.txt')) {
    logger.info(
      `Skipping modification of input file as it is not a .txt file: ${inputFilepath}`,
    );
    return;
  }

  try {
    const successfullyProcessedUrls = new Set<string>();
    for (const taskResult of taskResults) {
      if (taskResult && taskResult.type === 'success' && taskResult.data.url) {
        successfullyProcessedUrls.add(taskResult.data.url);
      }
    }

    // const remainingUrlsInScope = urlsInCurrentProcessingScope.filter(
    //   (url: string) => !successfullyProcessedUrls.has(url),
    // );

    // For .txt files, we rewrite the file with only the remaining URLs.
    // If the original file contained URLs outside the current processing scope (e.g., due to --range),
    // those URLs are not touched here. This function only manages URLs within the current scope.
    // A more robust approach for mixed content or preserving original order would require reading the original file
    // and then filtering, but for simplicity, we're working with `urlsInCurrentProcessingScope`.

    let finalUrlsToWrite: string[];

    if (fs.existsSync(inputFilepath)) {
      const originalContent = fs.readFileSync(inputFilepath, 'utf8');
      const originalUrls = originalContent
        .split('\n')
        .filter((line) => line.trim() !== '');

      // Create a set of URLs from the current processing scope for efficient lookup
      const currentScopeSet = new Set(urlsInCurrentProcessingScope);

      // Filter original URLs: keep those not in the current scope,
      // or if in scope, only if they were not successfully processed.
      finalUrlsToWrite = originalUrls.filter((url) => {
        if (currentScopeSet.has(url)) {
          // If URL was in current scope
          return !successfullyProcessedUrls.has(url); // Keep if not successful
        }
        return true; // Keep if not in current scope (preserve other URLs)
      });
    } else {
      // If the input file doesn't exist (e.g., first run or deleted),
      // then the "remaining" URLs are just those from the current scope that weren't successful.
      logger.warn(
        `Input file ${inputFilepath} not found for updating. Will create it with remaining URLs from current scope.`,
      );
      finalUrlsToWrite = urlsInCurrentProcessingScope.filter(
        (url: string) => !successfullyProcessedUrls.has(url),
      );
    }

    fs.writeFileSync(
      inputFilepath,
      finalUrlsToWrite.join('\n') + (finalUrlsToWrite.length > 0 ? '\n' : ''),
      'utf8',
    );
    logger.info(
      `${inputFilepath} updated. ${successfullyProcessedUrls.size} URLs from current scope successfully processed. ${finalUrlsToWrite.length} URLs written to file.`,
    );
  } catch (e: unknown) {
    // Use unknown for better type safety
    const writeError = e as Error;
    logger.error(`Failed to update ${inputFilepath}: ${writeError.message}`, {
      stack: writeError.stack,
    });
  }
}
