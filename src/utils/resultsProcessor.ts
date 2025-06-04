import * as fs from 'fs';
import type { Logger as WinstonLogger } from 'winston';
import { PrebidExplorerOptions, PageData, TaskResult } from '../prebid.js'; // Assuming types are in prebid.ts

/**
 * @internal
 * Utility class for processing and saving the results of the Prebid exploration.
 */
export class ResultsProcessor {
    private logger: WinstonLogger;
    private options: PrebidExplorerOptions;

    constructor(options: PrebidExplorerOptions, logger: WinstonLogger) {
        this.options = options;
        this.logger = logger;
    }

    /**
     * Processes the task results, logs information, and saves the data to JSON files.
     * Also handles updating the input file if applicable.
     * @param taskResults - An array of {@link TaskResult} from the Puppeteer tasks.
     * @param processedUrls - A Set of URLs that were actually processed or attempted.
     * @param urlsToProcess - An array of all URLs that were initially slated for processing (after range, before chunking).
     * @param urlSourceType - A string indicating the source of the URLs (e.g., 'InputFile', 'GitHub').
     */
    public saveResults(
        taskResults: TaskResult[],
        processedUrls: Set<string>,
        urlsToProcess: string[],
        urlSourceType: string
    ): PageData[] {
        const finalResults: PageData[] = [];

        for (const taskResult of taskResults) {
            if (!taskResult) {
                this.logger.warn(`A task returned no result. This should not happen.`);
                continue;
            }
            if (taskResult.type === 'success') {
                this.logger.info(`Data found for ${taskResult.data.url}`, { url: taskResult.data.url });
                finalResults.push(taskResult.data);
            } else if (taskResult.type === 'no_data') {
                this.logger.warn('No Prebid data found for URL (summary)', { url: taskResult.url });
            } else if (taskResult.type === 'error') {
                this.logger.error('Error processing URL (summary)', { url: taskResult.url, error: taskResult.error });
            }
        }

        this.logger.info('Final Results Array Count:', { count: finalResults.length });

        try {
            if (!fs.existsSync(this.options.outputDir)) {
                fs.mkdirSync(this.options.outputDir, { recursive: true });
            }

            if (finalResults.length > 0) {
                const now: Date = new Date();
                const month: string = now.toLocaleString('default', { month: 'short' });
                const year: number = now.getFullYear();
                const day: string = String(now.getDate()).padStart(2, '0');
                const monthDir: string = `${this.options.outputDir}/${month}`;
                const dateFilename: string = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}-${day}.json`;

                if (!fs.existsSync(monthDir)) {
                    fs.mkdirSync(monthDir, { recursive: true });
                }

                const jsonOutput: string = JSON.stringify(finalResults, null, 2);
                fs.writeFileSync(`${monthDir}/${dateFilename}`, jsonOutput + '\n', 'utf8');
                this.logger.info(`Results have been written to ${monthDir}/${dateFilename}`);
            } else {
                this.logger.info('No results to save.');
            }

            if (urlSourceType === 'InputFile' && this.options.inputFile) {
                if (this.options.inputFile.endsWith('.txt')) {
                    // urlsToProcess contains the list of URLs *after* any range was applied.
                    // processedUrls contains URLs that were actually sent to a task.
                    // The difference is URLs that were in scope but perhaps not attempted due to errors or chunking issues.
                    // However, for simplicity and current logic, we save URLs that were in the processing scope but are not in processedUrls.
                    const remainingUrlsInAttemptedScope: string[] = urlsToProcess.filter((url: string) => !processedUrls.has(url));
                    try {
                        fs.writeFileSync(this.options.inputFile, remainingUrlsInAttemptedScope.join('\n'), 'utf8');
                        this.logger.info(`${this.options.inputFile} updated. ${processedUrls.size} URLs processed from the current scope, ${remainingUrlsInAttemptedScope.length} URLs remain in current scope.`);
                    } catch (writeError: any) {
                        this.logger.error(`Failed to update ${this.options.inputFile}: ${writeError.message}`);
                    }
                } else {
                    this.logger.info(`Skipping modification of original ${this.options.inputFile.endsWith('.csv') ? 'CSV' : 'JSON'} input file: ${this.options.inputFile}`);
                }
            }
        } catch (err: any) {
            this.logger.error('Failed to write results or update input file system', { error: err });
        }
        return finalResults; // Return the processed results array
    }
}
