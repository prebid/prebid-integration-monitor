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
import { categorizeErrorForFile, formatDetailedError } from './error-types.js';

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
        // Log structured error details with enhanced categorization if available
        const detailedError = taskResult.error.detailedError;
        if (detailedError) {
          logger.error(
            `ERROR: Processing failed for ${taskResult.url} - Category: ${detailedError.category}/${detailedError.subCategory}, Code: ${detailedError.code}, Phase: ${detailedError.phase}`,
            {
              url: taskResult.url,
              errorDetails: taskResult.error,
              detailedError: detailedError,
            }
          );
        } else {
          logger.error(
            `ERROR: Processing failed for ${taskResult.url} - Code: ${taskResult.error.code}, Msg: ${taskResult.error.message}`,
            { url: taskResult.url, errorDetails: taskResult.error }
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
 * Writes an array of {@link PageData} objects to a JSON file in the store directory.
 * The file is organized into a directory structure based on the current year and month,
 * using the format `store/<mmm-yyyy>/<yyyy-mm-dd>.json` (e.g., `store/Apr-2025/2025-04-15.json`).
 * If the target directory does not exist, it will be created. Results are appended to existing files.
 *
 * @param {PageData[]} resultsToSave - An array of `PageData` objects to be written to the file.
 *                                     If empty or undefined, the function logs this and returns without writing.
 * @param {string} baseOutputDir - The root directory where the dated subdirectories and result files will be created.
 * @param {WinstonLogger} logger - An instance of WinstonLogger for logging messages, including success or failure of file operations.
 * @example
 * const dataToSave = [{ url: 'https://a.com', libraries: [], date: '2023-01-01', prebidInstances: [] }];
 * writeResultsToStoreFile(dataToSave, "/app", logger);
 * // This might create a file like /app/store/Jan-2023/2023-01-15.json (assuming current date is Jan 15, 2023)
 */
export function writeResultsToStoreFile(
  resultsToSave: PageData[],
  baseOutputDir: string,
  logger: WinstonLogger
): void {
  if (!resultsToSave || resultsToSave.length === 0) {
    logger.info('No results to save to store file.');
    return;
  }

  try {
    const now = new Date();
    const year = now.getFullYear().toString();
    const monthPadded = String(now.getMonth() + 1).padStart(2, '0'); // Ensure two digits for month
    const monthShort = now.toLocaleString('default', { month: 'short' }); // e.g., "Jan", "Feb"
    const dayPadded = String(now.getDate()).padStart(2, '0'); // Ensure two digits for day

    // Create store directory structure: store/mmm-yyyy format (e.g., "Apr-2025")
    const storeDir = path.join(baseOutputDir, 'store');
    const monthDir = path.join(storeDir, `${monthShort}-${year}`);

    if (!fs.existsSync(monthDir)) {
      fs.mkdirSync(monthDir, { recursive: true }); // Create directory recursively if it doesn't exist
      logger.info(`Created store directory: ${monthDir}`);
    }

    const dateFilename = `${year}-${monthPadded}-${dayPadded}.json`;
    const filePath = path.join(monthDir, dateFilename);

    // Check if file exists to append to existing data
    let existingData: PageData[] = [];
    if (fs.existsSync(filePath)) {
      try {
        const existingContent = fs.readFileSync(filePath, 'utf8');
        if (existingContent.trim()) {
          existingData = JSON.parse(existingContent);
          if (!Array.isArray(existingData)) {
            existingData = [];
          }
        }
      } catch {
        logger.warn(
          `Failed to parse existing file ${filePath}, will overwrite`
        );
        existingData = [];
      }
    }

    // Append new results to existing data
    const combinedData = [...existingData, ...resultsToSave];
    const jsonOutput = JSON.stringify(combinedData, null, 2); // Pretty print JSON
    fs.writeFileSync(filePath, jsonOutput + '\n', 'utf8'); // Add newline for POSIX compatibility
    logger.info(
      `Successfully wrote ${resultsToSave.length} new results (${combinedData.length} total) to ${filePath}`
    );
  } catch (e: unknown) {
    const err = e as Error; // Cast to Error for standard properties
    logger.error('Failed to write results to store file system.', {
      errorName: err.name,
      errorMessage: err.message,
      stack: err.stack, // Include stack trace for debugging
    });
    // Note: This function currently does not re-throw the error.
    // The caller (e.g., prebidExplorer) will continue, potentially without saved results for this batch.
  }
}

/**
 * Writes an array of {@link PageData} objects to a JSON file.
 * The file is organized into a directory structure based on the current year and month,
 * and the filename includes the current date (e.g., `<outputDir>/<YYYY-MM-Mon>/<YYYY-MM-DD>.json`).
 * If the target directory (including year-month subdirectory) does not exist, it will be created.
 *
 * @param {PageData[]} resultsToSave - An array of `PageData` objects to be written to the file.
 *                                     If empty or undefined, the function logs this and returns without writing.
 * @param {string} baseOutputDir - The root directory where the dated subdirectories and result files will be created.
 * @param {WinstonLogger} logger - An instance of WinstonLogger for logging messages, including success or failure of file operations.
 * @example
 * const dataToSave = [{ url: 'https://a.com', libraries: [], date: '2023-01-01', prebidInstances: [] }];
 * writeResultsToFile(dataToSave, "/app/output", logger);
 * // This might create a file like /app/output/2023-01-Jan/2023-01-15.json (assuming current date is Jan 15, 2023)
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

    // Create a year-month directory, e.g., "2023-01-Jan"
    const monthDir = path.join(
      baseOutputDir,
      `${year}-${monthPadded}-${monthShort}`
    );
    if (!fs.existsSync(monthDir)) {
      fs.mkdirSync(monthDir, { recursive: true }); // Create directory recursively if it doesn't exist
      logger.info(`Created output directory: ${monthDir}`);
    }

    const dateFilename = `${year}-${monthPadded}-${dayPadded}.json`;
    const filePath = path.join(monthDir, dateFilename);

    const jsonOutput = JSON.stringify(resultsToSave, null, 2); // Pretty print JSON
    fs.writeFileSync(filePath, jsonOutput + '\n', 'utf8'); // Add newline for POSIX compatibility
    logger.info(
      `Successfully wrote ${resultsToSave.length} results to ${filePath}`
    );
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
 * Appends URLs to the no_prebid.txt file when no prebid data is found.
 * This function automatically logs URLs that returned 'no_data' results to track sites without Prebid integration.
 *
 * @param {TaskResult[]} taskResults - An array of task results to process
 * @param {WinstonLogger} logger - An instance of WinstonLogger for logging messages
 */
export function appendNoPrebidUrls(
  taskResults: TaskResult[],
  logger: WinstonLogger
): void {
  const noPrebidUrls = taskResults
    .filter((result) => result && result.type === 'no_data')
    .map((result) => (result as any).url)
    .filter((url) => url);

  if (noPrebidUrls.length === 0) {
    return;
  }

  try {
    const noPrebidFilePath = path.join(
      process.cwd(),
      'errors',
      'no_prebid.txt'
    );

    // Ensure errors directory exists
    const errorsDir = path.dirname(noPrebidFilePath);
    if (!fs.existsSync(errorsDir)) {
      fs.mkdirSync(errorsDir, { recursive: true });
      logger.info(`Created errors directory: ${errorsDir}`);
    }

    // Append URLs to the file, one per line
    const urlsToAppend = noPrebidUrls.join('\n') + '\n';
    fs.appendFileSync(noPrebidFilePath, urlsToAppend, 'utf8');

    logger.info(`Appended ${noPrebidUrls.length} URLs to no_prebid.txt`);
  } catch (e: unknown) {
    const err = e as Error;
    logger.error('Failed to append URLs to no_prebid.txt', {
      errorName: err.name,
      errorMessage: err.message,
      stack: err.stack,
    });
  }
}

/**
 * Appends URLs to appropriate error files based on detailed error categorization.
 * Errors are distributed to specific files based on their category and error code:
 * - navigation_errors.txt: DNS and connection errors
 * - ssl_errors.txt: Certificate and SSL protocol errors
 * - timeout_errors.txt: Various timeout conditions
 * - access_errors.txt: Authentication, rate limiting, bot detection
 * - content_errors.txt: HTTP errors, page availability issues
 * - browser_errors.txt: Puppeteer/browser-specific errors
 * - extraction_errors.txt: JavaScript evaluation errors
 * - error_processing.txt: Unknown or uncategorized errors
 *
 * @param {TaskResult[]} taskResults - An array of task results to process
 * @param {WinstonLogger} logger - An instance of WinstonLogger for logging messages
 */
export function appendErrorUrls(
  taskResults: TaskResult[],
  logger: WinstonLogger
): void {
  const errorResults = taskResults.filter(
    (result) => result && result.type === 'error'
  );

  if (errorResults.length === 0) {
    return;
  }

  // Group errors by their target file
  const errorFileMap: Map<string, string[]> = new Map();

  for (const result of errorResults) {
    const errorResult = result as any;
    const url = errorResult.url;
    const error = errorResult.error;
    const detailedError = error?.detailedError;

    let logEntry: string;
    let targetFile: string;

    if (detailedError) {
      // Use detailed error categorization
      logEntry = formatDetailedError(detailedError);
      targetFile = categorizeErrorForFile(detailedError);
    } else {
      // Fallback to basic error handling for backward compatibility
      const errorCode = error?.code || 'UNKNOWN';
      const errorMessage = error?.message || 'Unknown error';
      const timestamp = new Date().toISOString();

      if (errorCode.includes('ERR_NAME_NOT_RESOLVED')) {
        logEntry = `${url},${errorCode}`;
        targetFile = 'navigation_errors.txt';
      } else {
        logEntry = `${timestamp} | URL: ${url} | Message: ${errorMessage} | Error: ${errorCode}`;
        targetFile = 'error_processing.txt';
      }
    }

    // Add to appropriate error file group
    if (!errorFileMap.has(targetFile)) {
      errorFileMap.set(targetFile, []);
    }
    errorFileMap.get(targetFile)!.push(logEntry);
  }

  try {
    const errorsDir = path.join(process.cwd(), 'errors');

    // Ensure errors directory exists
    if (!fs.existsSync(errorsDir)) {
      fs.mkdirSync(errorsDir, { recursive: true });
      logger.info(`Created errors directory: ${errorsDir}`);
    }

    // Write to each error file
    for (const [filename, errors] of errorFileMap.entries()) {
      if (errors.length > 0) {
        const errorFilePath = path.join(errorsDir, filename);
        const content = errors.join('\n') + '\n';
        fs.appendFileSync(errorFilePath, content, 'utf8');
        logger.info(`Appended ${errors.length} errors to ${filename}`);
      }
    }
  } catch (e: unknown) {
    const err = e as Error;
    logger.error('CRITICAL: Failed to append URLs to error files - data may be lost!', {
      errorName: err.name,
      errorMessage: err.message,
      stack: err.stack,
      errorCategories: Array.from(errorFileMap.keys()),
      totalErrors: taskResults.filter(r => r.type === 'error').length,
    });
    
    // Log sample of lost errors for debugging
    const sampleErrors = taskResults.filter(r => r.type === 'error').slice(0, 3);
    sampleErrors.forEach((error, index) => {
      logger.error(`  Sample lost error ${index + 1}: ${error.url} - ${error.error.message}`);
    });
  }
}

/**
 * Creates header files for each error type to explain the format and content.
 * This function should be called once when initializing the error directory structure.
 *
 * @param {WinstonLogger} logger - An instance of WinstonLogger for logging messages
 */
export function createErrorFileHeaders(logger: WinstonLogger): void {
  const errorsDir = path.join(process.cwd(), 'errors');

  // Define headers for each error file type
  const errorFileHeaders: Record<string, string> = {
    'navigation_errors.txt': `# Navigation Errors
# DNS resolution failures, connection refused, network issues
# Format: [timestamp] | Category: network/<subcat> | Phase: <phase> | Code: <code> | URL: <url> | Message: <msg>
`,
    'ssl_errors.txt': `# SSL/Certificate Errors
# Invalid certificates, expired certs, SSL protocol errors
# Format: [timestamp] | Category: ssl/<subcat> | Phase: <phase> | Code: <code> | URL: <url> | Message: <msg>
`,
    'timeout_errors.txt': `# Timeout Errors
# Navigation timeouts, operation timeouts, element wait timeouts
# Format: [timestamp] | Category: timeout/<subcat> | Phase: <phase> | Code: <code> | URL: <url> | Message: <msg>
`,
    'access_errors.txt': `# Access Control Errors
# Authentication failures, rate limiting, bot detection, CDN protection
# Format: [timestamp] | Category: access/<subcat> | Phase: <phase> | Code: <code> | URL: <url> | Message: <msg>
`,
    'content_errors.txt': `# Content Errors
# 404 not found, 500 server errors, page unavailable
# Format: [timestamp] | Category: content/<subcat> | Phase: <phase> | Code: <code> | URL: <url> | Message: <msg>
`,
    'browser_errors.txt': `# Browser/Puppeteer Errors
# Session closed, protocol errors, browser crashes
# Format: [timestamp] | Category: browser/<subcat> | Phase: <phase> | Code: <code> | URL: <url> | Message: <msg>
`,
    'extraction_errors.txt': `# Data Extraction Errors
# JavaScript evaluation failures, property access errors
# Format: [timestamp] | Category: extraction/<subcat> | Phase: <phase> | Code: <code> | URL: <url> | Message: <msg>
`,
    'error_processing.txt': `# General Processing Errors
# Unknown or uncategorized errors
# Format: [timestamp] | URL: <url> | Message: <msg> | Error: <code>
`,
    'no_prebid.txt': `# Sites Without Prebid
# URLs that were successfully processed but had no Prebid.js or ad tech detected
# Format: <url>
`,
  };

  try {
    // Ensure errors directory exists
    if (!fs.existsSync(errorsDir)) {
      fs.mkdirSync(errorsDir, { recursive: true });
      logger.info(`Created errors directory: ${errorsDir}`);
    }

    // Create header files if they don't exist
    for (const [filename, header] of Object.entries(errorFileHeaders)) {
      const filePath = path.join(errorsDir, filename);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, header, 'utf8');
        logger.info(`Created error file with header: ${filename}`);
      }
    }
  } catch (e: unknown) {
    const err = e as Error;
    logger.error('Failed to create error file headers', {
      errorName: err.name,
      errorMessage: err.message,
      stack: err.stack,
    });
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
