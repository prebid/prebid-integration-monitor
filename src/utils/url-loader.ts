/**
 * @fileoverview This module provides utility functions for loading URLs from various sources.
 * It supports extracting URLs from local text, JSON, and CSV files, as well as fetching
 * URLs from files hosted in GitHub repositories.
 */

import * as fs from 'fs';
import fetch, { Response as FetchResponse } from 'node-fetch'; // Import Response type
import { parse } from 'csv-parse/sync';
import type { Logger as WinstonLogger } from 'winston';
import { GitHubFetchTracer, URLLoadingTracer } from './telemetry.js';
import { getContentCache } from './content-cache.js';

/**
 * Processes the string content of a file to extract URLs based on the file type.
 * It supports `.txt` files (line-separated URLs, schemeless domain detection),
 * `.json` files (extracts all string values that are URLs), and
 * `.csv` files (extracts URLs from the first column).
 *
 * @param {string} fileName - The name of the file (e.g., "urls.txt", "data.json"). Used to determine parsing strategy.
 * @param {string} content - The actual text content of the file.
 * @param {WinstonLogger} logger - Logger instance for operational logging.
 * @returns {Promise<string[]>} A promise that resolves to an array of unique URLs extracted from the content.
 *                               Returns an empty array if no URLs are found or if the file type is unsupported.
 * @example
 * // Processing a TXT file's content
 * const txtContent = "example.com\nhttps://another.org";
 * const urlsFromTxt = await processFileContent("urls.txt", txtContent, logger);
 * console.log(urlsFromTxt); // Output: ["https://example.com", "https://another.org"]
 *
 * // Processing a JSON file's content
 * const jsonContent = '{"site": "https://example.json.com", "links": ["http://link1.com"]}';
 * const urlsFromJSON = await processFileContent("data.json", jsonContent, logger);
 * console.log(urlsFromJSON); // Output: ["https://example.json.com", "http://link1.com"]
 */
export async function processFileContent(
  fileName: string,
  content: string,
  logger: WinstonLogger
): Promise<string[]> {
  const extractedUrls = new Set<string>(); // Use Set for automatic deduplication and uniqueness
  const urlRegex = /(https?:\/\/[^\s"]+)/gi; // Regex for finding fully qualified URLs
  const schemelessDomainRegex =
    /(^|\s|"|')([a-zA-Z0-9-_]+\.)+[a-zA-Z]{2,}(\s|\\"|"|'|$)/g; // Adjusted to handle quotes and escaped quotes

  // Always try to find fully qualified URLs first
  const fqdnMatches = content.match(urlRegex);
  if (fqdnMatches) {
    fqdnMatches.forEach((url) => extractedUrls.add(url.trim()));
  }

  // Check for .txt files OR files that appear to contain domain lists (no extension, likely domain files)
  const isDomainFile =
    fileName.endsWith('.txt') ||
    (!fileName.includes('.') && content.includes('.com'));

  if (isDomainFile) {
    logger.info(`Processing domain file: ${fileName} for schemeless domains.`);

    // For domain list files, process line by line to handle pure domain names
    const lines = content.split('\n');
    let domainsFound = 0;

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (
        trimmedLine &&
        !trimmedLine.startsWith('#') &&
        !trimmedLine.startsWith('//')
      ) {
        // Check if it looks like a domain name
        if (
          /^[a-zA-Z0-9][a-zA-Z0-9-_]*\.([a-zA-Z]{2,}|[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})$/.test(
            trimmedLine
          )
        ) {
          const fullUrl = `https://${trimmedLine}`;
          if (!extractedUrls.has(fullUrl)) {
            extractedUrls.add(fullUrl);
            domainsFound++;
            if (domainsFound <= 5) {
              logger.info(
                `Found and added domain as ${fullUrl} from ${fileName}`
              );
            }
          }
        }
      }
    }

    if (domainsFound > 5) {
      logger.info(
        `Added ${domainsFound} total domains from ${fileName} (showing first 5)`
      );
    }

    // Also try the original regex approach for any missed domains
    const schemelessMatches = content.match(schemelessDomainRegex);
    if (schemelessMatches) {
      schemelessMatches.forEach((domain) => {
        const cleanedDomain = domain.trim().replace(/^["']|["']$/g, ''); // Remove surrounding quotes
        if (cleanedDomain && !cleanedDomain.includes('://')) {
          // Ensure it's actually schemeless
          const fullUrl = `https://${cleanedDomain}`;
          if (!extractedUrls.has(fullUrl)) {
            // Avoid adding if already found as FQDN
            extractedUrls.add(fullUrl);
          }
        }
      });
    }
  } else if (fileName.endsWith('.json')) {
    logger.info(`Processing .json file: ${fileName}`);
    try {
      // More specific type for JSON parsed content, assuming it could be anything.
      // A user-defined type guard or a library like Zod could be used for deeper validation if structure is known.
      const jsonData: unknown = JSON.parse(content);
      const urlsFromJson = new Set<string>();

      function extractUrlsFromJsonRecursive(data: unknown) {
        // Parameter 'data' is now unknown
        if (typeof data === 'string') {
          const jsonStringMatches = data.match(urlRegex);
          if (jsonStringMatches) {
            jsonStringMatches.forEach((url) => urlsFromJson.add(url.trim()));
          }
        } else if (Array.isArray(data)) {
          data.forEach((item) => extractUrlsFromJsonRecursive(item));
        } else if (typeof data === 'object' && data !== null) {
          Object.values(data).forEach((value) =>
            extractUrlsFromJsonRecursive(value)
          );
        }
      }

      extractUrlsFromJsonRecursive(jsonData);
      if (urlsFromJson.size > 0) {
        logger.info(
          `Extracted ${urlsFromJson.size} URLs from parsed JSON structure in ${fileName}`
        );
        urlsFromJson.forEach((url) => extractedUrls.add(url));
      }
    } catch (e: unknown) {
      // Use unknown for better type safety
      const parseError = e as Error;
      logger.warn(
        `Failed to parse JSON from ${fileName}. Falling back to regex scan of raw content. Error: ${parseError.message}`
      );
      // Fallback is covered by the initial fqdnMatches scan at the beginning of the function
    }
  } else if (fileName.endsWith('.csv')) {
    // Correctly chain the .csv block
    logger.info(`Processing .csv file: ${fileName}`);
    try {
      const records: string[][] = parse(content, {
        // Assuming CSV parse returns array of string arrays
        columns: false,
        skip_empty_lines: true,
      });
      for (const record of records) {
        if (record && record.length > 0 && typeof record[0] === 'string') {
          // record[0] is a string
          const url = record[0].trim();
          if (url.startsWith('http://') || url.startsWith('https://')) {
            extractedUrls.add(url);
          } else if (url) {
            logger.warn(
              `Skipping invalid or non-HTTP/S URL from CSV content in ${fileName}: "${url}"`
            );
          }
        }
      }
      logger.info(
        `Extracted ${extractedUrls.size} URLs from CSV content in ${fileName} (after initial regex scan)`
      );
    } catch (e: unknown) {
      // Use unknown for better type safety
      const csvError = e as Error;
      logger.warn(
        `Failed to parse CSV content from ${fileName}. Error: ${csvError.message}`
      );
      // Regex scan at the beginning of the function acts as a fallback
    }
  }
  // Ensure a value is always returned
  return Array.from(extractedUrls);
}

/**
 * Optimized URL fetching with range-aware processing to prevent memory and timeout issues
 * @param {string} content - File content to process
 * @param {string} fileName - File name for processing logic
 * @param {number | undefined} startRange - Starting index for range (1-based)
 * @param {number | undefined} endRange - Ending index for range (1-based)
 * @param {WinstonLogger} logger - Logger instance
 * @returns {Promise<string[]>} Optimized URL array for the specified range
 */
export async function processContentWithRangeOptimization(
  content: string,
  fileName: string,
  startRange: number | undefined,
  endRange: number | undefined,
  logger: WinstonLogger
): Promise<string[]> {
  const extractedUrls: string[] = [];

  // Check if this is a domain file that needs line-by-line processing
  const isDomainFile =
    fileName.endsWith('.txt') ||
    (!fileName.includes('.') && content.includes('.com'));

  if (isDomainFile && (startRange || endRange)) {
    const lines = content.split('\n');
    logger.info(
      `Optimized processing: extracting range ${startRange || 1}-${endRange || 'end'} from domain file (lines.length=${lines.length})`
    );
    const startIdx = startRange ? startRange - 1 : 0; // Convert to 0-based
    const endIdx = endRange ? Math.min(endRange, lines.length) : lines.length; // endRange is 1-based, keep as-is for exclusive loop
    logger.info(
      `Debug: startRange=${startRange}, endRange=${endRange}, startIdx=${startIdx}, endIdx=${endIdx}, will process ${endIdx - startIdx} lines`
    );
    logger.info(
      `DEBUG: First line in range: ${lines[startIdx]}, Last line in range: ${lines[endIdx - 1]}`
    );

    // Process only the requested range
    for (let i = startIdx; i < endIdx; i++) {
      const trimmedLine = lines[i]?.trim();
      if (
        trimmedLine &&
        !trimmedLine.startsWith('#') &&
        !trimmedLine.startsWith('//')
      ) {
        if (
          /^[a-zA-Z0-9][a-zA-Z0-9-_]*\.([a-zA-Z]{2,}|[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})$/.test(
            trimmedLine
          )
        ) {
          const url = `https://${trimmedLine}`;
          extractedUrls.push(url);
          // Log first 5 URLs for debugging
          if (extractedUrls.length <= 5) {
            logger.info(`DEBUG: URL #${i + 1} (position ${i + 1}): ${trimmedLine} -> ${url}`);
          }
        }
      }
    }

    logger.info(
      `Optimized processing: extracted ${extractedUrls.length} URLs from range ${startIdx + 1}-${endIdx} (0-based: ${startIdx}-${endIdx - 1})`
    );
    return extractedUrls;
  }

  // Fallback to full processing for small files or non-range requests
  return processFileContent(fileName, content, logger);
}

/**
 * Fetches URLs from a GitHub repository. It can target a specific file (including raw content links)
 * or scan the root directory of a repository for `.txt`, `.md`, and `.json` files to extract URLs from.
 *
 * @param {string} repoUrl - The URL of the GitHub repository (e.g., "https://github.com/owner/repo")
 *                           or a direct link to a file within the repository (e.g., "https://github.com/owner/repo/blob/main/urls.txt")
 *                           or a raw content link (e.g., "https://raw.githubusercontent.com/owner/repo/main/urls.txt").
 * @param {(number | undefined)} numUrls - An optional limit on the total number of unique URLs to fetch.
 *                                       If undefined, all found URLs are returned.
 * @param {WinstonLogger} logger - Logger instance for operational logging.
 * @param {object} rangeOptions - Optional range optimization parameters
 * @param {number} rangeOptions.startRange - Starting index for range-based processing (1-based)
 * @param {number} rangeOptions.endRange - Ending index for range-based processing (1-based)
 * @returns {Promise<string[]>} A promise that resolves to an array of unique URLs fetched from the specified GitHub source.
 *                               Returns an empty array if the repository/file is inaccessible or no URLs are found.
 * @example
 * const repoURLs = await fetchUrlsFromGitHub("https://github.com/prebid/prebid-js-setup-examples", 10, logger);
 * console.log(repoURLs); // Output: Array of up to 10 URLs from .txt, .md, .json files in the repo root.
 *
 * const fileURLs = await fetchUrlsFromGitHub("https://github.com/owner/repo/blob/main/url-list.txt", undefined, logger, {startRange: 1000, endRange: 2000});
 * console.log(fileURLs); // Output: Array of URLs from lines 1000-2000 of the specified file.
 */
export async function fetchUrlsFromGitHub(
  repoUrl: string,
  numUrls: number | undefined,
  logger: WinstonLogger,
  rangeOptions?: { startRange?: number; endRange?: number }
): Promise<string[]> {
  const tracer = new GitHubFetchTracer(repoUrl, logger);
  const cache = getContentCache(logger);

  logger.info(`Attempting to fetch URLs from GitHub source: ${repoUrl}`);

  const allExtractedUrls = new Set<string>(); // Use Set for deduplication during collection

  try {
    // Check if the URL is a direct link to a file view (contains /blob/)
    if (repoUrl.includes('/blob/')) {
      logger.info(
        `Detected direct file link: ${repoUrl}. Attempting to fetch raw content.`
      );
      const rawUrl = repoUrl
        .replace('github.com', 'raw.githubusercontent.com')
        .replace('/blob/', '/');
      const fileName = repoUrl.substring(repoUrl.lastIndexOf('/') + 1);
      logger.info(`DEBUG: Fetching file - fileName=${fileName}, rawUrl=${rawUrl}`);

      // Check cache first
      let content = cache.get(rawUrl);
      let fromCache = true;

      if (!content) {
        logger.info(`Fetching content directly from raw GitHub URL: ${rawUrl}`);
        fromCache = false;
        const fileResponse: FetchResponse = await fetch(rawUrl);
        tracer.recordHttpRequest(
          rawUrl,
          fileResponse.status,
          parseInt(fileResponse.headers.get('content-length') || '0')
        );

        if (fileResponse.ok) {
          content = await fileResponse.text();

          // Cache the content for future use
          const etag = fileResponse.headers.get('etag') || undefined;
          cache.set(rawUrl, content, etag);
          logger.debug(
            `Cached content for ${rawUrl} (${content.length} characters)`
          );
        } else {
          const errorBody = await fileResponse.text();
          const error = new Error(
            `HTTP ${fileResponse.status}: ${fileResponse.statusText}. Body: ${errorBody}`
          );
          tracer.recordError(error, 'file_fetch');
          logger.error(
            `Failed to download content from direct file link: ${rawUrl} - Status: ${fileResponse.status} ${fileResponse.statusText}`
          );
          logger.error(`Error body: ${errorBody}`);
          tracer.finish(0);
          return []; // Return empty if direct file fetch fails
        }
      } else {
        logger.info(`Using cached content for ${rawUrl}`);
        tracer.recordHttpRequest(rawUrl, 200, content.length);
      }

      if (content) {
        tracer.recordParsingResults(content.split('\n').length, 0, 0); // Will update after processing

        const urlsFromFile = await processContentWithRangeOptimization(
          content,
          fileName,
          rangeOptions?.startRange,
          rangeOptions?.endRange,
          logger
        );
        urlsFromFile.forEach((url) => allExtractedUrls.add(url));
        tracer.recordParsingResults(
          content.split('\n').length,
          urlsFromFile.length,
          0
        );

        logger.info(
          `Extracted ${urlsFromFile.length} URLs from ${fromCache ? 'cached' : 'fresh'} content: ${rawUrl}`
        );
      }
    } else {
      // Existing logic for repository directory listing
      logger.info(`Processing as repository URL: ${repoUrl}`);
      const repoPathMatch = repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
      if (!repoPathMatch || !repoPathMatch[1]) {
        logger.error(
          `Invalid GitHub repository URL format: ${repoUrl}. Expected format like https://github.com/owner/repo`
        );
        return [];
      }
      const repoPath = repoPathMatch[1].replace(/\.git$/, '');

      const contentsUrl = `https://api.github.com/repos/${repoPath}/contents`; // Using /contents without a subpath to list root.
      logger.info(
        `Fetching repository root contents list from: ${contentsUrl}`
      );

      const repoResponse: FetchResponse = await fetch(contentsUrl, {
        headers: { Accept: 'application/vnd.github.v3+json' }, // Request JSON response
      });

      if (!repoResponse.ok) {
        logger.error(
          `Failed to fetch repository contents: ${repoResponse.status} ${repoResponse.statusText}`,
          { url: contentsUrl }
        );
        const errorBody = await repoResponse.text();
        logger.error(`GitHub API Error Body: ${errorBody}`);
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
        | GitHubContent; // API can return single object if path is to a file

      const filesToProcess: GitHubContent[] = Array.isArray(contents)
        ? contents
        : [contents];

      const targetExtensions = ['.txt', '.md', '.json'];
      logger.info(
        `Found ${filesToProcess.length} items in the repository path. Filtering for files with extensions: ${targetExtensions.join(', ')}.`
      );

      for (const item of filesToProcess) {
        if (
          item.type === 'file' &&
          item.name &&
          item.download_url &&
          targetExtensions.some((ext) => item.name.endsWith(ext))
        ) {
          logger.info(
            `Fetching content for file: ${item.path} from ${item.download_url}`
          );
          try {
            const fileResponse: FetchResponse = await fetch(item.download_url);
            if (fileResponse.ok) {
              const content: string = await fileResponse.text();
              const urlsFromFile = await processFileContent(
                item.name,
                content,
                logger
              );
              urlsFromFile.forEach((url) => allExtractedUrls.add(url));
              logger.info(
                `Extracted ${urlsFromFile.length} URLs from ${item.path}. Total unique URLs so far: ${allExtractedUrls.size}`
              );
            } else {
              logger.warn(
                `Failed to download file content: ${item.path} - Status: ${fileResponse.status}`
              );
            }
          } catch (fileError: unknown) {
            const typedFileError = fileError as Error;
            logger.error(
              `Error fetching or processing file ${item.path}: ${typedFileError.message}`,
              { fileUrl: item.download_url }
            );
          }

          if (numUrls && allExtractedUrls.size >= numUrls) {
            logger.info(
              `Reached or exceeded URL limit of ${numUrls}. Stopping further file processing from GitHub.`
            );
            break;
          }
        }
      }
    }

    const finalUrls = Array.from(allExtractedUrls);
    const limitedUrls = numUrls ? finalUrls.slice(0, numUrls) : finalUrls;

    logger.info(
      `Total unique URLs extracted from GitHub before applying limit: ${finalUrls.length}`
    );

    tracer.finish(limitedUrls.length);
    return limitedUrls;
  } catch (e: unknown) {
    const error = e as Error;
    tracer.recordError(error, 'general_processing');
    logger.error(`Error processing GitHub URL ${repoUrl}: ${error.message}`, {
      stack: error.stack,
      url: repoUrl,
    });
    tracer.finish(0);
    return [];
  }
}

/**
 * Loads the content of a local file from the specified file path.
 *
 * @param {string} filePath - The absolute or relative path to the file.
 * @param {WinstonLogger} logger - Logger instance for operational logging.
 * @returns {(string | null)} The content of the file as a UTF-8 string,
 *                            or `null` if an error occurs during reading (e.g., file not found).
 * @example
 * const content = loadFileContents("./my-urls.txt", logger);
 * if (content) {
 *   console.log("File content:", content);
 * } else {
 *   console.error("Failed to read file.");
 * }
 */
export function loadFileContents(
  filePath: string,
  logger: WinstonLogger
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
      stack: error.stack,
    });
    return null; // Return null or throw error as per desired error handling strategy
  }
}
