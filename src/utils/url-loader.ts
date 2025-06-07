/**
 * @fileoverview This module provides utility functions for loading URLs from various sources.
 * It supports extracting URLs from local text, JSON, and CSV files, as well as fetching
 * URLs from files hosted in GitHub repositories.
 */

import * as fs from 'fs';
import fetch, { Response as FetchResponse } from 'node-fetch'; // Import Response type
import { parse } from 'csv-parse/sync';
import type { Logger as WinstonLogger } from 'winston';

/**
 * Processes the string content of a file to extract URLs based on the file type.
 *
 * Supported file types and their processing logic:
 * - `.txt`: Each line is treated as a potential URL. Schemeless domains (e.g., `example.com`)
 *   are automatically prepended with `https://`.
 * - `.json`: Recursively scans all string values within the JSON structure and extracts
 *   those that match a URL pattern. If JSON parsing fails, it falls back to a regex scan of the raw content.
 * - `.csv`: Extracts URLs from the first column of each row. Only URLs starting with `http://` or `https://` are considered.
 *
 * All extracted URLs are deduplicated.
 *
 * @param {string} fileName - The name of the file (e.g., "urls.txt", "data.json").
 *                            Used to determine the parsing strategy (TXT, JSON, CSV).
 * @param {string} content - The actual text content of the file.
 * @param {WinstonLogger} logger - Logger instance for operational logging.
 * @returns {Promise<string[]>} A promise that resolves to an array of unique URLs extracted from the content.
 *                               Returns an empty array if no URLs are found, the file type is unsupported,
 *                               or an unrecoverable error occurs during processing.
 * @example
 * // Processing a TXT file's content
 * const txtContent = "example.com\nhttps://another.org";
 * const urlsFromTxt = await processFileContent("urls.txt", txtContent, logger);
 * // urlsFromTxt would be ["https://example.com", "https://another.org"]
 *
 * // Processing a JSON file's content
 * const jsonContent = '{"site": "https://example.json.com", "links": ["http://link1.com"], "ignore": "not_a_url"}';
 * const urlsFromJSON = await processFileContent("data.json", jsonContent, logger);
 * // urlsFromJSON would be ["https://example.json.com", "http://link1.com"]
 *
 * // Processing a CSV file's content
 * const csvContent = "https://csv-example.com,description\nignorethis.com,another value";
 * const urlsFromCSV = await processFileContent("data.csv", csvContent, logger);
 * // urlsFromCSV would be ["https://csv-example.com"]
 */
export async function processFileContent(
  fileName: string,
  content: string,
  logger: WinstonLogger,
): Promise<string[]> {
  const extractedUrls = new Set<string>(); // Use Set for automatic deduplication and uniqueness
  const urlRegex = /(https?:\/\/[^\s"]+)/gi; // Regex for finding fully qualified URLs
  const schemelessDomainRegex =
    /(^|\s|"|')([a-zA-Z0-9-_]+\.)+[a-zA-Z]{2,}(\s|\\"|"|'|$)/g; // Adjusted to handle quotes and escaped quotes

  // Always try to find fully qualified URLs first from the raw content.
  // This acts as a basic fallback for JSON/CSV if parsing fails, and primary for TXT/MD.
  const fqdnMatches = content.match(urlRegex);
  if (fqdnMatches) {
    fqdnMatches.forEach((url) => extractedUrls.add(url.trim()));
  }

  if (fileName.endsWith('.txt') || fileName.endsWith('.md')) { // Treat .md like .txt for URL extraction
    logger.info(`Processing .txt/.md file: ${fileName} for schemeless domains.`);
    // Find schemeless domains in .txt and .md files
    const schemelessMatches = content.match(schemelessDomainRegex);
    if (schemelessMatches) {
      schemelessMatches.forEach((domain) => {
        const cleanedDomain = domain.trim().replace(/^["']|["']$/g, ''); // Remove surrounding quotes
        if (cleanedDomain && !cleanedDomain.includes('://')) {
          // Ensure it's actually schemeless and not part of a malformed URL already captured
          const fullUrl = `https://${cleanedDomain}`;
          if (!extractedUrls.has(fullUrl)) {
            // Avoid adding if already found as FQDN (e.g. https://example.com vs example.com)
            extractedUrls.add(fullUrl);
            logger.info(
              `Found and added schemeless domain as ${fullUrl} from ${fileName}`,
            );
          }
        }
      });
    }
  } else if (fileName.endsWith('.json')) {
    logger.info(`Processing .json file: ${fileName}`);
    try {
      const jsonData: unknown = JSON.parse(content);
      const urlsFromJson = new Set<string>();

      function extractUrlsFromJsonRecursive(data: unknown) {
        if (typeof data === 'string') {
          // Check if the string itself is a URL
          if (urlRegex.test(data)) { // Reset regex lastIndex before test
             urlRegex.lastIndex = 0;
             extractedUrls.add(data.trim());
          }
          // Also check for URLs embedded within a larger string value (less common for primary URLs)
          // const jsonStringMatches = data.match(urlRegex);
          // if (jsonStringMatches) {
          //   jsonStringMatches.forEach((url) => urlsFromJson.add(url.trim()));
          // }
        } else if (Array.isArray(data)) {
          data.forEach((item) => extractUrlsFromJsonRecursive(item));
        } else if (typeof data === 'object' && data !== null) {
          Object.values(data).forEach((value) =>
            extractUrlsFromJsonRecursive(value),
          );
        }
      }

      extractUrlsFromJsonRecursive(jsonData);
      // URLs from JSON are directly added to extractedUrls by the recursive function
      // No need to log urlsFromJson.size here as it's not used for accumulation
    } catch (e: unknown) {
      const parseError = e as Error;
      logger.warn(
        `Failed to parse JSON from ${fileName}. URLs will be extracted using regex from raw content if possible. Error: ${parseError.message}`,
      );
      // Fallback is covered by the initial fqdnMatches scan at the beginning of the function
    }
  } else if (fileName.endsWith('.csv')) {
    logger.info(`Processing .csv file: ${fileName}`);
    try {
      const records: string[][] = parse(content, {
        columns: false,
        skip_empty_lines: true,
      });
      for (const record of records) {
        // Only consider the first column for URLs
        if (record && record.length > 0 && typeof record[0] === 'string') {
          const url = record[0].trim();
          // Check if it's a fully qualified HTTP/HTTPS URL
          if (url.startsWith('http://') || url.startsWith('https://')) {
            extractedUrls.add(url);
          } else if (url && !url.includes('://') && schemelessDomainRegex.test(` ${url} `)) {
            // If schemeless, prepend https://, ensuring it's not already captured.
            // Test with spaces to ensure regex matches domain-like strings.
            schemelessDomainRegex.lastIndex = 0; // Reset regex state
            const fullUrl = `https://${url}`;
            if(!extractedUrls.has(fullUrl)) {
                 extractedUrls.add(fullUrl);
                 logger.info(`Found and added schemeless domain as ${fullUrl} from CSV ${fileName}`);
            }
          } else if (url) { // Log if it's not a valid URL or schemeless domain
            logger.warn(
              `Skipping invalid or non-HTTP/S URL from CSV content in ${fileName}: "${url}"`,
            );
          }
        }
      }
    } catch (e: unknown) {
      const csvError = e as Error;
      logger.warn(
        `Failed to parse CSV content from ${fileName}. URLs will be extracted using regex from raw content if possible. Error: ${csvError.message}`,
      );
      // Regex scan at the beginning of the function acts as a fallback
    }
  }
  return Array.from(extractedUrls);
}

/**
 * Fetches URLs from a GitHub repository.
 *
 * It can target:
 * 1. A specific file view URL (e.g., `https://github.com/owner/repo/blob/main/urls.txt`).
 *    This will be converted to its raw content URL for fetching.
 * 2. A direct raw content URL (e.g., `https://raw.githubusercontent.com/owner/repo/main/urls.txt`).
 * 3. A repository root URL (e.g., `https://github.com/owner/repo`).
 *    In this case, it lists files in the root directory and processes `.txt`, `.md`, and `.json` files
 *    to extract URLs using {@link processFileContent}.
 *
 * @param {string} repoUrl - The URL of the GitHub repository or a direct link to a file.
 * @param {(number | undefined)} numUrls - An optional limit on the total number of unique URLs to fetch.
 *                                       If undefined or 0, all found URLs are returned (up to internal GitHub API limits if scanning a repo).
 * @param {WinstonLogger} logger - Logger instance for operational logging.
 * @returns {Promise<string[]>} A promise that resolves to an array of unique URLs.
 *                               Returns an empty array if the repository/file is inaccessible, no processable files are found, or no URLs are extracted.
 * @example
 * // Fetch up to 10 URLs from .txt, .md, .json files in the repo root
 * const repoURLs = await fetchUrlsFromGitHub("https://github.com/prebid/prebid-js-setup-examples", 10, logger);
 *
 * // Fetch all URLs from a specific file on GitHub
 * const fileURLs = await fetchUrlsFromGitHub("https://github.com/owner/repo/blob/main/url-list.txt", undefined, logger);
 */
export async function fetchUrlsFromGitHub(
  repoUrl: string,
  numUrls: number | undefined,
  logger: WinstonLogger,
): Promise<string[]> {
  logger.info(`Attempting to fetch URLs from GitHub source: ${repoUrl}`);

  const allExtractedUrls = new Set<string>(); // Use Set for deduplication during collection

  try {
    // Normalize GitHub blob URLs to raw content URLs
    let effectiveUrl = repoUrl;
    if (repoUrl.includes('/blob/')) {
      effectiveUrl = repoUrl
        .replace('github.com', 'raw.githubusercontent.com')
        .replace('/blob/', '/');
      logger.info(`Converted GitHub blob URL to raw content URL: ${effectiveUrl}`);
    }

    // Check if the URL points directly to a raw file content (common for raw.githubusercontent.com or specific file links)
    // This is a heuristic; more robust checking might involve content-type or specific API path patterns.
    const isDirectFileLink = effectiveUrl.startsWith('https://raw.githubusercontent.com/') ||
                             /\.(txt|json|md|csv)$/i.test(effectiveUrl.split('?')[0]);


    if (isDirectFileLink) {
      const fileName = effectiveUrl.substring(effectiveUrl.lastIndexOf('/') + 1).split('?')[0]; // Get filename before query params
      logger.info(`Fetching content directly from URL (assumed file): ${effectiveUrl}`);
      const fileResponse: FetchResponse = await fetch(effectiveUrl);
      if (fileResponse.ok) {
        const content: string = await fileResponse.text();
        const urlsFromFile = await processFileContent(
          fileName,
          content,
          logger,
        );
        urlsFromFile.forEach((url) => allExtractedUrls.add(url));
        logger.info(
          `Extracted ${urlsFromFile.length} URLs from direct link: ${effectiveUrl}`,
        );
      } else {
        logger.error(
          `Failed to download content from direct link: ${effectiveUrl} - Status: ${fileResponse.status} ${fileResponse.statusText}`,
        );
        // const errorBody = await fileResponse.text(); // Potentially large, log with caution
        // logger.error(`Error body (first 500 chars): ${errorBody.substring(0,500)}`);
        return [];
      }
    } else {
      // Process as a repository directory listing
      logger.info(`Processing as repository URL to list contents: ${repoUrl}`);
      const repoPathMatch = repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
      if (!repoPathMatch || !repoPathMatch[1]) {
        logger.error(
          `Invalid GitHub repository URL format: ${repoUrl}. Expected format like https://github.com/owner/repo`,
        );
        return [];
      }
      const repoPath = repoPathMatch[1].replace(/\.git$/, '');

      const contentsUrl = `https://api.github.com/repos/${repoPath}/contents`;
      logger.info(
        `Fetching repository root contents list from: ${contentsUrl}`,
      );

      const repoResponse: FetchResponse = await fetch(contentsUrl, {
        headers: { Accept: 'application/vnd.github.v3+json' },
      });

      if (!repoResponse.ok) {
        logger.error(
          `Failed to fetch repository contents: ${repoResponse.status} ${repoResponse.statusText}`,
          { url: contentsUrl },
        );
        // const errorBody = await repoResponse.text();
        // logger.error(`GitHub API Error Body (first 500 chars): ${errorBody.substring(0,500)}`);
        return [];
      }

      interface GitHubContent {
        type: 'file' | 'dir' | 'symlink' | 'submodule';
        name: string;
        path: string;
        download_url: string | null;
      }
      const contents = (await repoResponse.json()) as
        | GitHubContent[]
        | GitHubContent;

      const filesToProcess: GitHubContent[] = Array.isArray(contents)
        ? contents
        : [contents];

      const targetExtensions = ['.txt', '.md', '.json', '.csv']; // Added .csv
      logger.info(
        `Found ${filesToProcess.length} items in the repository path. Filtering for files with extensions: ${targetExtensions.join(', ')}.`,
      );

      for (const item of filesToProcess) {
        if (
          item.type === 'file' &&
          item.name &&
          item.download_url &&
          targetExtensions.some((ext) => item.name.toLowerCase().endsWith(ext)) // case-insensitive check
        ) {
          logger.info(
            `Fetching content for file: ${item.path} from ${item.download_url}`,
          );
          try {
            const fileResponse: FetchResponse = await fetch(item.download_url);
            if (fileResponse.ok) {
              const content: string = await fileResponse.text();
              const urlsFromFile = await processFileContent(
                item.name, // Pass item.name (which includes extension)
                content,
                logger,
              );
              urlsFromFile.forEach((url) => allExtractedUrls.add(url));
              logger.info(
                `Extracted ${urlsFromFile.length} URLs from ${item.path}. Total unique URLs so far: ${allExtractedUrls.size}`,
              );
            } else {
              logger.warn(
                `Failed to download file content: ${item.path} - Status: ${fileResponse.status}`,
              );
            }
          } catch (fileError: unknown) {
            const typedFileError = fileError as Error;
            logger.error(
              `Error fetching or processing file ${item.path}: ${typedFileError.message}`,
              { fileUrl: item.download_url },
            );
          }

          if (numUrls && allExtractedUrls.size >= numUrls) {
            logger.info(
              `Reached or exceeded URL limit of ${numUrls}. Stopping further file processing from GitHub.`,
            );
            break;
          }
        }
      }
    }

    const finalUrls = Array.from(allExtractedUrls);
    logger.info(
      `Total unique URLs extracted from GitHub before applying limit: ${finalUrls.length}`,
    );
    return numUrls ? finalUrls.slice(0, numUrls) : finalUrls;
  } catch (e: unknown) {
    const error = e as Error;
    logger.error(`Error processing GitHub URL ${repoUrl}: ${error.message}`, {
      stack: error.stack,
      url: repoUrl,
    });
    return [];
  }
}

/**
 * Loads the content of a local file from the specified file path.
 *
 * @param {string} filePath - The absolute or relative path to the file.
 * @param {WinstonLogger} logger - Logger instance for operational logging.
 * @returns {(string | null)} The content of the file as a UTF-8 string,
 *                            or `null` if an error occurs during reading (e.g., file not found, permission denied).
 * @example
 * const content = loadFileContents("./my-urls.txt", logger);
 * if (content) {
 *   console.log("File content:", content);
 * } else {
 *   // An error occurred, details logged by loadFileContents
 *   console.error("Failed to read file.");
 * }
 */
export function loadFileContents(
  filePath: string,
  logger: WinstonLogger,
): string | null {
  logger.info(`Attempting to read local file: ${filePath}`);
  try {
    const content: string = fs.readFileSync(filePath, 'utf8');
    logger.info(`Successfully read file: ${filePath}`);
    return content;
  } catch (e: unknown) {
    // Use unknown for better type safety
    const error = e as Error;
    logger.error(`Failed to read file ${filePath}: ${error.message}`, {
      stack: error.stack, // Include stack for better debugging of file system errors
    });
    return null; // Return null or throw error as per desired error handling strategy
  }
}

[end of src/utils/url-loader.ts]
