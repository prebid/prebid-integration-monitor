import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs'; // Keep for reading and writing input.txt
import path from 'path';
import logger from './utils/logger.js'; // .js extension may be needed
import { INPUT_FILE_PATH } from './utils/parser.js';

const execAsync = promisify(exec);

interface CheckUrlResultValid {
    url: string;
    valid: true;
}

interface CheckUrlResultInvalid {
    url: string;
    valid: false;
    statusCode?: number;
    error?: string;
}

type CheckUrlResult = CheckUrlResultValid | CheckUrlResultInvalid;

async function checkUrl(url: string): Promise<CheckUrlResult> {
  try {
    // Use curl to check the HTTP status code. -I for header-only, -s for silent, -o /dev/null to discard output.
    const { stdout, stderr } = await execAsync(`curl --max-time 25 -I -s -o /dev/null -w "%{http_code}" ${url}`);
    const statusCode: number = parseInt(stdout.trim(), 10);

    if (statusCode >= 200 && statusCode < 400) {
      return { url, valid: true };
    } else {
      return { url, valid: false, statusCode }; // Include status code for invalid URLs
    }
  } catch (error: any) {
    // Handle errors like network issues or invalid URLs that curl can't process
    logger.error(`Error checking URL via curl: ${url}`, { url, error: error.message, stack: error.stack });
    return { url, valid: false, error: error.message }; // Include the error message
  }
}

interface ProcessUrlsResult {
    validUrls: string[];
    invalidUrls: CheckUrlResultInvalid[];
}

async function processUrls(urls: string[]): Promise<ProcessUrlsResult> {
  const results: CheckUrlResult[] = await Promise.all(urls.map(checkUrl));

  const validUrls: string[] = results.filter((result): result is CheckUrlResultValid => result.valid).map(result => result.url);
  const invalidUrls: CheckUrlResultInvalid[] = results.filter((result): result is CheckUrlResultInvalid => !result.valid);

  return { validUrls, invalidUrls };
}

async function main(): Promise<void> {
  const inputFile: string = path.join('input', 'preload_urls.txt'); // Define the input file path
  // const errorOutputFile: string = path.join('errors', 'preload_errors.txt'); // Replaced by Winston logs
  // const errorDir: string = path.dirname(errorOutputFile); // Not needed

  let urls: string[] = [];

  // Read URLs from the input file
  try {
    const fileContent: string = fs.readFileSync(inputFile, 'utf8');
    urls = fileContent.split('\n').map((url: string) => url.trim()).filter((url: string) => url.length > 0);
  } catch (err: any) {
    logger.error(`Error reading URLs from ${inputFile}`, { error: err.message, stack: err.stack, code: err.code });
    if (err.code === 'ENOENT') {
      logger.error(`Please ensure the file ${inputFile} exists and the script has permission to read it.`);
    }
    return; // Exit if the file cannot be read
  }

  if (urls.length === 0) {
    logger.info(`No URLs found in ${inputFile}.`);
    return;
  }

  logger.info(`Processing ${urls.length} URLs from ${inputFile}...`);
  const { validUrls, invalidUrls } = await processUrls(urls);

  // Write valid URLs to input.txt, each on a new line
  try {
    // Assuming input.txt is for the main prebid script, clear it first or append carefully.
    // For this example, appending. Consider if this should be 'w' (write) to overwrite.
    fs.appendFileSync(INPUT_FILE_PATH, validUrls.join('\n') + (validUrls.length > 0 ? '\n' : ''));
    logger.info(`Successfully wrote ${validUrls.length} valid URLs to ${INPUT_FILE_PATH}`);
  } catch (err: any) {
    logger.error(`Error writing to ${INPUT_FILE_PATH}`, { error: err.message, stack: err.stack });
  }

  // Log invalid URLs using Winston
  if (invalidUrls.length > 0) {
    logger.warn(`Found ${invalidUrls.length} invalid URLs during preload check.`);
    invalidUrls.forEach((item: CheckUrlResultInvalid) => {
      logger.warn('Invalid URL detected', {
        url: item.url,
        statusCode: item.statusCode || 'N/A',
        error: item.error || 'N/A'
      });
    });
    // The old method of writing to errorOutputFile is removed.
    // fs.appendFileSync(errorOutputFile, errorLines.join('\n') + '\n');
    // logger.info(`Successfully wrote ${invalidUrls.length} invalid URL details to ${errorOutputFile}`);
  } else {
    logger.info('No invalid URLs found during preload check.');
    // Clearing the old error file is not necessary as it's no longer used.
    // try {
    //     if (fs.existsSync(errorOutputFile)) {
    //         fs.appendFileSync(errorOutputFile, '');
    //         logger.info(`Cleared existing error file: ${errorOutputFile}`);
    //     }
    // } catch (err: any) {
    //     logger.error(`Error clearing ${errorOutputFile}:`, { error: err.message, stack: err.stack });
    // } // This closing brace for the commented out try-catch was the issue.
  }
}

main();