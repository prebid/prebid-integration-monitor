import * as fs from 'fs';
import { initializeLogger } from './utils/logger.js';
import type { Logger as WinstonLogger } from 'winston';
import { addExtra } from 'puppeteer-extra';
import puppeteerVanilla, { Browser, PuppeteerLaunchOptions } from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import blockResourcesPluginFactory from 'puppeteer-extra-plugin-block-resources';
import { Cluster } from 'puppeteer-cluster';
import { Page } from 'puppeteer';

// Helper function to configure a new page
async function configurePage(page: Page): Promise<Page> { // page is passed directly by puppeteer-cluster
    page.setDefaultTimeout(55000);
    // Set to a common Chrome user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    return page;
}

// Define interfaces for page data
interface PrebidInstance {
    globalVarName: string;
    version: string;
    modules: string[];
}

interface PageData {
    libraries: string[];
    date: string;
    prebidInstances?: PrebidInstance[];
    url?: string; // Added url to PageData
}

interface TaskResultSuccess {
    type: 'success';
    data: PageData;
}

interface TaskResultNoData {
    type: 'no_data';
    url: string;
}

interface TaskResultError {
    type: 'error';
    url: string;
    error: string;
}

type TaskResult = TaskResultSuccess | TaskResultNoData | TaskResultError;

export interface PrebidExplorerOptions {
    inputFile?: string; // Make optional as it might not be needed if githubRepo is used
    githubRepo?: string;
    numUrls?: number;
    puppeteerType: 'vanilla' | 'cluster';
    concurrency: number;
    headless: boolean;
    monitor: boolean;
    outputDir: string;
    logDir: string;
    puppeteerLaunchOptions?: PuppeteerLaunchOptions;
}

let logger: WinstonLogger;

const puppeteer = addExtra(puppeteerVanilla as any);

// Helper function to fetch URLs from GitHub
async function fetchUrlsFromGitHub(repoUrl: string, numUrls: number | undefined, logger: WinstonLogger): Promise<string[]> {
  logger.info(`Fetching URLs from GitHub repository source: ${repoUrl}`);
  const extractedUrls: string[] = [];
  const urlRegex = /(https?:\/\/[^\s"]+)/gi;

  try {
    // Check if the URL is a direct link to a file view (contains /blob/)
    if (repoUrl.includes('/blob/')) {
      logger.info(`Detected direct file link: ${repoUrl}. Attempting to fetch raw content.`);
      // Transform GitHub file view URL to raw content URL
      // Example: https://github.com/owner/repo/blob/branch/path/to/file.txt
      // Becomes: https://raw.githubusercontent.com/owner/repo/branch/path/to/file.txt
      const rawUrl = repoUrl.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
      
      logger.info(`Fetching content directly from raw URL: ${rawUrl}`);
      const fileResponse = await fetch(rawUrl);
      if (fileResponse.ok) {
        const content = await fileResponse.text();
        const matches = content.match(urlRegex);
        if (matches) {
          matches.forEach(url => extractedUrls.push(url.trim()));
          logger.info(`Extracted ${matches.length} URLs from ${rawUrl}`);
        } else {
          logger.info(`No URLs found in content from ${rawUrl}`);
        }
      } else {
        logger.error(`Failed to download direct file content: ${rawUrl} - ${fileResponse.status} ${fileResponse.statusText}`);
        const errorBody = await fileResponse.text();
        logger.error(`Error body: ${errorBody}`);
        return []; // Return empty if direct file fetch fails
      }
    } else {
      // Existing logic for repository directory listing
      logger.info(`Processing as repository URL: ${repoUrl}`);
      const repoPathMatch = repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
      if (!repoPathMatch || !repoPathMatch[1]) {
        logger.error(`Invalid GitHub repository URL format: ${repoUrl}. Expected format like https://github.com/owner/repo`);
        return [];
      }
      const repoPath = repoPathMatch[1].replace(/\.git$/, '');

      const contentsUrl = `https://api.github.com/repos/${repoPath}/contents`;
      logger.info(`Fetching repository contents from: ${contentsUrl}`);

      const response = await fetch(contentsUrl, {
        headers: { Accept: 'application/vnd.github.v3+json' },
      });

      if (!response.ok) {
        logger.error(`Failed to fetch repository contents: ${response.status} ${response.statusText}`, { url: contentsUrl });
        const errorBody = await response.text();
        logger.error(`Error body: ${errorBody}`);
        return [];
      }

      const files = await response.json();
      if (!Array.isArray(files)) {
        logger.error('Expected an array of files from GitHub API, but received something else.', { response: files });
        return [];
      }

      const targetExtensions = ['.txt', '.md'];
      logger.info(`Found ${files.length} items in the repository. Filtering for ${targetExtensions.join(', ')} files.`);

      for (const file of files) {
        if (file.type === 'file' && targetExtensions.some(ext => file.name.endsWith(ext))) {
          logger.info(`Fetching content for file: ${file.path} from ${file.download_url}`);
          try {
            const fileResponse = await fetch(file.download_url);
            if (fileResponse.ok) {
              const content = await fileResponse.text();
              const matches = content.match(urlRegex);
              if (matches) {
                matches.forEach(url => extractedUrls.push(url.trim()));
                logger.info(`Extracted ${matches.length} URLs from ${file.path}`);
              }
            } else {
              logger.warn(`Failed to download file content: ${file.path} - ${fileResponse.status}`);
            }
          } catch (fileError: any) {
            logger.error(`Error fetching or processing file ${file.path}: ${fileError.message}`, { fileUrl: file.download_url });
          }

          if (numUrls && extractedUrls.length >= numUrls) {
            logger.info(`Reached URL limit of ${numUrls}. Stopping further file processing.`);
            break;
          }
        }
      }
    }

    logger.info(`Total URLs extracted before limiting: ${extractedUrls.length}`);
    return numUrls ? extractedUrls.slice(0, numUrls) : extractedUrls;

  } catch (error: any) {
    logger.error(`Error processing GitHub URL ${repoUrl}: ${error.message}`, { stack: error.stack });
    return [];
  }
}


export async function prebidExplorer(options: PrebidExplorerOptions): Promise<void> {
    logger = initializeLogger(options.logDir);

    // Apply puppeteer-extra plugins
    puppeteer.use(StealthPlugin());

    const blockResources = (blockResourcesPluginFactory as any)();
    if (blockResources && blockResources.blockedTypes && typeof blockResources.blockedTypes.add === 'function') {
      const typesToBlock: Set<any> = new Set<any>([
          'image', 'font', 'websocket', 'media',
          'texttrack', 'eventsource', 'manifest', 'other'
      ]);
      typesToBlock.forEach(type => blockResources.blockedTypes.add(type));
      puppeteer.use(blockResources); // Use the configured instance
    } else {
      logger.warn('Could not configure blockResourcesPlugin: blockedTypes property or .add method not available on instance.', { plugin: blockResources });
    }

    const basePuppeteerOptions: PuppeteerLaunchOptions = {
        protocolTimeout: 1000000,
        defaultViewport: null,
        headless: options.headless,
        args: options.puppeteerLaunchOptions?.args || [],
        ...options.puppeteerLaunchOptions
    };

    let results: PageData[] = [];
    const taskResults: TaskResult[] = [];
    let allUrls: string[] = [];
    const processedUrls: Set<string> = new Set();

    if (options.githubRepo) {
        allUrls = await fetchUrlsFromGitHub(options.githubRepo, options.numUrls, logger);
        if (allUrls.length > 0) {
            logger.info(`Successfully loaded ${allUrls.length} URLs from GitHub repository: ${options.githubRepo}`);
        } else {
            // Changed from logger.error to logger.warn to be consistent with overall "no URLs" handling
            logger.warn(`No URLs found or fetched from GitHub repository: ${options.githubRepo}.`);
            // The generic check for allUrls.length === 0 below will handle exiting.
        }
    } else if (options.inputFile) {
        try {
            allUrls = fs.readFileSync(options.inputFile, 'utf8').split('\n').map((url: string) => url.trim()).filter((url: string) => url.length > 0);
            logger.info(`Initial URLs read from ${options.inputFile}`, { count: allUrls.length });
        } catch (fileError: any) {
            logger.error(`Failed to read input file ${options.inputFile}: ${fileError.message}`);
            // this.error(`Failed to read input file: ${options.inputFile}`, { exit: 1}); // Using 'this.error' might not be available here.
            throw new Error(`Failed to read input file: ${options.inputFile}`); // Prefer throwing for unrecoverable errors.
            // return; // Exit if file cannot be read // Not needed due to throw
        }
    } else {
        logger.error('No URL source provided. Either --inputFile or --githubRepo must be specified.');
        throw new Error('No URL source specified. Either --inputFile or --githubRepo must be specified.'); // Critical configuration error
        // return; // Exit if no source // Not needed due to throw
    }

    if (allUrls.length === 0) {
        logger.warn('No URLs to process. Exiting.');
        return;
    }
    logger.info(`Total URLs to process: ${allUrls.length}`, { firstFew: allUrls.slice(0, 5) });


    // Define the core processing task (used by both vanilla and cluster)
    const processPageTask = async (page: Page, url: string): Promise<TaskResult> => {
        const trimmedUrl: string = url;
        logger.info(`Processing: ${trimmedUrl}`, { url: trimmedUrl });
        try {
            await configurePage(page);
            await page.goto(trimmedUrl, { timeout: 60000, waitUntil: 'networkidle2' });

            await page.evaluate(async () => {
                const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
                await sleep((1000 * 60) * .10); // 6 seconds delay
            });

            const pageData: PageData = await page.evaluate((): PageData => {
                const data: Partial<PageData> = {};
                data.libraries = [];
                data.date = new Date().toISOString().slice(0, 10);
                if ((window as any).apstag) data.libraries.push('apstag');
                if ((window as any).googletag) data.libraries.push('googletag');
                if ((window as any).ats) data.libraries.push('ats');
                if ((window as any)._pbjsGlobals && Array.isArray((window as any)._pbjsGlobals)) {
                    data.prebidInstances = [];
                    (window as any)._pbjsGlobals.forEach(function(globalVarName: string) {
                        const pbjsInstance = (window as any)[globalVarName];
                        if (pbjsInstance && pbjsInstance.version && pbjsInstance.installedModules) {
                            data.prebidInstances!.push({
                                globalVarName: globalVarName,
                                version: pbjsInstance.version,
                                modules: pbjsInstance.installedModules
                            });
                        }
                    });
                }
                return data as PageData;
            });
            pageData.url = trimmedUrl;
            if (pageData.libraries.length > 0 || (pageData.prebidInstances && pageData.prebidInstances.length > 0)) {
                return { type: 'success', data: pageData };
            } else {
                logger.warn(`No relevant Prebid or ad library data found for ${trimmedUrl}`, { url: trimmedUrl });
                return { type: 'no_data', url: trimmedUrl };
            }
        } catch (pageError: any) {
            logger.error(`Error processing ${trimmedUrl}`, { url: trimmedUrl, error: pageError });
            const errorMessage: string = pageError.message || '';
            const netErrorMatch: RegExpMatchArray | null = errorMessage.match(/net::([A-Z_]+)/);
            let errorCode: string;
            if (netErrorMatch) {
                errorCode = netErrorMatch[1];
            } else {
                const prefix: string = `Error processing ${trimmedUrl}: `;
                if (errorMessage.startsWith(prefix)) {
                    errorCode = errorMessage.substring(prefix.length).trim();
                } else {
                    errorCode = errorMessage.trim() || 'UNKNOWN_ERROR';
                }
                errorCode = errorCode.replace(/\s+/g, '_').toUpperCase();
            }
            return { type: 'error', url: trimmedUrl, error: errorCode };
        }
    };


    if (options.puppeteerType === 'cluster') {
        const cluster: Cluster<string, TaskResult> = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_CONTEXT,
            maxConcurrency: options.concurrency,
            monitor: options.monitor,
            puppeteer,
            puppeteerOptions: basePuppeteerOptions,
        });

        // The task function now returns TaskResult
        await cluster.task(async ({ page, data: url }: { page: Page, data: string }): Promise<TaskResult> => {
            const result = await processPageTask(page, url);
            return result;
        });

        try {
            const promises = allUrls.filter(url => url).map(url => {
                processedUrls.add(url);
                return cluster.queue(url)
                    .then(resultFromQueue => {
                        return resultFromQueue;
                    })
                    .catch(error => {
                        logger.error(`Error from cluster.queue for ${url}:`, { error });
                        // Create and return a TaskResult for errors during queueing/task execution
                        const errorResult: TaskResult = { type: 'error', url: url, error: 'QUEUE_ERROR_OR_TASK_FAILED' };
                        return errorResult;
                    });
            });

            const settledResults = await Promise.allSettled(promises);

            settledResults.forEach(settledResult => {
                if (settledResult.status === 'fulfilled') {
                    taskResults.push(settledResult.value as TaskResult);
                } else {
                    logger.error('A promise from cluster.queue settled as rejected, which was not expected as errors should be converted to TaskResult.', { reason: settledResult.reason });
                }
            });

            await cluster.idle();
            await cluster.close();
        } catch (error: any) {
            logger.error("An unexpected error occurred during cluster processing orchestration", { error });
            if (cluster) await cluster.close();
        }
    } else { // 'vanilla' Puppeteer
        let browser: Browser | null = null;
        try {
            browser = await puppeteer.launch(basePuppeteerOptions);
            for (const url of allUrls) {
                if (url) {
                    const page = await browser.newPage();
                    const result = await processPageTask(page, url);
                    taskResults.push(result);
                    await page.close();
                    processedUrls.add(url);
                }
            }
        } catch (error: any) {
            logger.error("An unexpected error occurred during vanilla Puppeteer processing", { error });
        } finally {
            if (browser) await browser.close();
        }
    }

    // Common result processing and file writing logic
    for (const taskResult of taskResults) {
        if (!taskResult) {
            logger.warn(`A task returned no result. This should not happen.`);
            continue;
        }
        if (taskResult.type === 'success') {
            logger.info(`Data found for ${taskResult.data.url}`, { url: taskResult.data.url });
            results.push(taskResult.data);
        } else if (taskResult.type === 'no_data') {
            logger.warn('No Prebid data found for URL (summary)', { url: taskResult.url });
        } else if (taskResult.type === 'error') {
            logger.error('Error processing URL (summary)', { url: taskResult.url, error: taskResult.error });
        }
    }

    logger.info('Final Results Array Count:', { count: results.length });

    try {
        if (!fs.existsSync(options.outputDir)) {
            fs.mkdirSync(options.outputDir, { recursive: true });
        }

        if (results.length > 0) {
            const now: Date = new Date();
            const month: string = now.toLocaleString('default', { month: 'short' });
            const year: number = now.getFullYear();
            const day: string = String(now.getDate()).padStart(2, '0');
            const monthDir: string = `${options.outputDir}/${month}`;
            const dateFilename: string = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}-${day}.json`;

            if (!fs.existsSync(monthDir)) {
                fs.mkdirSync(monthDir, { recursive: true });
            }

            const jsonOutput: string = JSON.stringify(results, null, 2);
            fs.writeFileSync(`${monthDir}/${dateFilename}`, jsonOutput + '\n', 'utf8');
            logger.info(`Results have been written to ${monthDir}/${dateFilename}`);
        } else {
            logger.info('No results to save.');
        }

        // Only update inputFile if it was the source of URLs
        if (options.inputFile && !options.githubRepo) {
            const remainingUrls: string[] = allUrls.filter((url: string) => !processedUrls.has(url));
            try {
                fs.writeFileSync(options.inputFile, remainingUrls.join('\n'), 'utf8');
                logger.info(`${options.inputFile} updated. ${processedUrls.size} URLs processed, ${remainingUrls.length} URLs remain.`);
            } catch (writeError: any) {
                logger.error(`Failed to update ${options.inputFile}: ${writeError.message}`);
            }
        }

    } catch (err: any) {
        logger.error('Failed to write results or update input file', { error: err });
    }
}
