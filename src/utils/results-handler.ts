/**
 * @fileoverview This module is responsible for handling the outcomes of page processing tasks.
 * It includes functions for logging different task results (success, no data, error),
 * aggregating successful data, writing these results to JSON files in an organized
 * directory structure, and updating input files (e.g., removing successfully processed URLs).
 */

import * as fs from 'fs'; // fs.existsSync is still used by appendToErrorFile, and current writeResultsToFile
import * as path from 'path'; // Import path module for robust file path operations
import type { Logger as WinstonLogger } from 'winston';
// Import shared types from the new common location
import type { TaskResult, PageData } from '../common/types.js';
import {
  ensureDirectoryExists,
  readJsonFile,
  writeJsonFile,
} from './file-system-utils.js'; // Corrected import path

/**
 * Processes an array of {@link TaskResult} objects. It logs the outcome of each task
 * (success, no data, or error) using the provided logger, aggregates all {@link PageData}
 * from successfully processed tasks, and triggers side effects such as writing URLs to
 * specific error files (e.g., for 'no_data' or 'error' types via `appendToErrorFile`).
 *
 * For tasks of type 'error', it logs the structured {@link ErrorDetails} including
 * `code`, `message`, and potentially `stack`. It also categorizes errors to different
 * files (e.g., navigation errors vs. other processing errors).
 *
 * @param {TaskResult[]} taskResults - An array of task results. Each element is an object
 *                                     conforming to the `TaskResult` discriminated union
 *                                     (i.e., {@link TaskResultSuccess}, {@link TaskResultNoData}, or {@link TaskResultError}).
 * @param {WinstonLogger} logger - An instance of WinstonLogger for logging messages and passing to helper functions.
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

        appendToErrorFile(
          path.join('errors', 'no_prebid.txt'),
          taskResult.url,
          logger
        );
        break;
      case 'error':
        const errorDetails = taskResult.error; // Standardize access
        const errorMessage = (errorDetails.message || '').toLowerCase();
        const errorCode = (errorDetails.code || '').toLowerCase();

        // Log structured error details (already done, but good to be aware of context)
        logger.error(
          `ERROR: Processing failed for ${taskResult.url} - Code: ${errorCode}, Msg: ${errorMessage}`,
          { url: taskResult.url, errorDetails: errorDetails }
        );

        // Determine error type for file logging
        if (
          errorCode.includes('enotfound') || // General DNS resolution failure
          errorCode.includes('err_name_not_resolved') || // Specific DNS resolution error code
          errorMessage.includes('dns probe finished nxdomain') || // Common browser DNS error message
          errorMessage.includes('net::err_name_not_resolved') // Chromium specific DNS error
        ) {
          appendToErrorFile(
            path.join('errors', 'navigation_errors.txt'),
            taskResult.url,
            logger
          );
        } else {
          appendToErrorFile(
            path.join('errors', 'error_processing.txt'),
            taskResult.url,
            logger
          );
        }
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
 * Appends a URL to a specified file, typically used for logging URLs that resulted in specific errors or conditions.
 * This function ensures that the directory for the `filePath` exists before attempting to append the URL.
 * If the directory does not exist, it will be created recursively.
 * Each URL is appended on a new line.
 *
 * @async
 * @function appendToErrorFile
 * @param {string} filePath - The path to the file where the URL should be appended (e.g., 'errors/no_prebid.txt').
 * @param {string} url - The URL string to append to the file.
 * @param {WinstonLogger} logger - An instance of WinstonLogger used for logging the operation's success or failure.
 * @returns {Promise<void>} A promise that resolves when the operation is complete.
 */
async function appendToErrorFile(
  filePath: string,
  url: string,
  logger: WinstonLogger
): Promise<void> {
  try {
    const dir = path.dirname(filePath);
    // Check if the directory exists, create it if it doesn't
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      logger.info(`Created directory for error file: ${dir}`);
    }
    fs.appendFileSync(filePath, url + '\n', 'utf8'); // Add newline for each URL
    logger.info(`Appended ${url} to ${filePath}`);
  } catch (e: unknown) {
    const err = e as Error; // Cast to Error for standard properties
    logger.error(`Failed to append URL to ${filePath}: ${err.message}`, {
      url,
      filePath,
      errorName: err.name, // Standard error properties
      stack: err.stack, // Include stack trace for debugging
    });
    // Depending on requirements, this could re-throw or handle more gracefully.
    // For now, it logs and continues.
  }
}

/**
 * Writes an array of {@link PageData} objects to a JSON file.
 * The function implements an append-or-create logic: if the target file already exists and contains
 * a valid JSON array, the new data is appended to it. Otherwise, a new file is created (or an
 * invalid existing file is overwritten).
 *
 * The output directory structure for these Prebid results is fixed as: `store/<Mmm-yyyy>/<yyyy-mm-dd>.json`,
 * (e.g., `store/Apr-2023/2023-04-01.json`).
 * The `_baseOutputDir` parameter is currently ignored for this specific output logic, with 'store/'
 * being used as the root.
 *
 * This function is asynchronous and leverages utility functions for directory creation and file operations.
 *
 * @async
 * @function writeResultsToFile
 * @param {PageData[]} resultsToSave - An array of `PageData` objects to be written.
 *                                     If empty or undefined, the function logs this and returns without writing.
 * @param {string} _baseOutputDir - This parameter is currently **ignored** for this function's primary logic,
 *                                  as the output path is hardcoded to `store/` for Prebid JSON results.
 *                                  It's maintained for potential signature compatibility elsewhere.
 * @param {WinstonLogger} logger - An instance of WinstonLogger for logging messages,
 *                                 including success or failure of file operations.
 * @returns {Promise<void>} A promise that resolves when the write operation is complete or if there's nothing to save.
 * @example
 * const dataToSave = [{ url: 'https://example.com', date: '2023-04-01', libraries: [], prebidInstances: [] }];
 * // This call will attempt to write/append to 'store/Apr-2023/2023-04-01.json' (assuming the current date is April 1, 2023).
 * await writeResultsToFile(dataToSave, "any_path_can_be_here_it_is_ignored", logger);
 */
export async function writeResultsToFile(
  resultsToSave: PageData[],
  _baseOutputDir: string, // Parameter's value is ignored for the 'store/' prebid data logic.
  logger: WinstonLogger
): Promise<void> {
  if (!resultsToSave || resultsToSave.length === 0) {
    logger.info('No results to save to file.');
    return;
  }

  const internalBaseDir = 'store'; // Hardcoded base directory

  try {
    const now = new Date();
    const year = now.getFullYear().toString(); // YYYY
    const monthShort = now.toLocaleString('en-US', { month: 'short' }); // Mmm (e.g., Apr)
    const monthPadded = String(now.getMonth() + 1).padStart(2, '0'); // MM for filename
    const dayPadded = String(now.getDate()).padStart(2, '0'); // DD for filename

    // Directory structure: store/Mmm-yyyy
    const outputDir = path.join(internalBaseDir, `${monthShort}-${year}`);

    // Ensure the directory exists
    await ensureDirectoryExists(outputDir); // Use await here

    const dateFilename = `${year}-${monthPadded}-${dayPadded}.json`;
    const filePath = path.join(outputDir, dateFilename);

    let finalResults: PageData[] = resultsToSave;

    // Check if file exists to append
    if (fs.existsSync(filePath)) {
      logger.info(`File ${filePath} exists. Attempting to read and append.`);
      try {
        const existingData = await readJsonFile<PageData[]>(filePath);
        if (Array.isArray(existingData)) {
          finalResults = existingData.concat(resultsToSave);
          logger.info(
            `Successfully read and appended ${resultsToSave.length} new results to ${filePath}. Total results: ${finalResults.length}`
          );
        } else {
          logger.warn(
            `Existing file ${filePath} is not a valid JSON array. Overwriting with new results.`
          );
          // finalResults is already resultsToSave
        }
      } catch (readError: any) {
        // Handle cases where readJsonFile throws an AppError (e.g. invalid JSON, file not found though existsSync passed)
        logger.warn(
          `Could not read or parse existing file ${filePath}. Error: ${readError.message}. Overwriting with new results.`,
          {
            errorCode: readError.details?.errorCode,
            originalErrorMessage: readError.details?.originalError?.message,
          }
        );
        // finalResults is already resultsToSave
      }
    } else {
      logger.info(`File ${filePath} does not exist. Creating new file.`);
    }

    await writeJsonFile(filePath, finalResults); // Use await here
    logger.info(
      `Successfully wrote ${finalResults.length} results to ${filePath}`
    );
  } catch (e: unknown) {
    const err = e as Error; // General error casting
    // Check if it's an AppError from our utils for more details
    let logDetails: any = {
      errorName: err.name,
      errorMessage: err.message,
      stack: err.stack,
    };
    if ((e as any).details?.errorCode) {
      logDetails.errorCode = (e as any).details.errorCode;
      logDetails.originalError = (e as any).details.originalError?.message;
    }
    logger.error('Failed to write results to file system.', logDetails);
    // Decide if to re-throw or handle. For now, it logs.
  }
}

/**
 * Updates a specified input file (expected to be a `.txt` file containing a list of URLs, one per line)
 * by removing URLs that were successfully processed in the current run.
 * This function is not directly related to `writeResultsToFile` changes but is part of the same file.
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
