import * as fs from 'fs';
import type { Logger as WinstonLogger } from 'winston';
import { parse } from 'csv-parse/sync';
import fetch from 'node-fetch';

/**
 * @internal
 * Utility class for processing and fetching URLs from various sources.
 */
export class UrlProcessor {
    private logger: WinstonLogger;

    constructor(logger: WinstonLogger) {
        this.logger = logger;
    }

    /**
     * Loads the content of a file from the local file system.
     * @param filePath - The path to the file.
     * @returns The content of the file as a string, or null if an error occurs.
     */
    public loadFileContents(filePath: string): string | null {
        this.logger.info(`Attempting to read file: ${filePath}`);
        try {
            const content: string = fs.readFileSync(filePath, 'utf8');
            this.logger.info(`Successfully read file: ${filePath}`);
            return content;
        } catch (error: any) {
            this.logger.error(`Failed to read file ${filePath}: ${error.message}`, { stack: error.stack });
            return null;
        }
    }

    /**
     * Processes the content of a file to extract URLs.
     * Supports .txt, .json, .md and .csv files.
     * For .txt and .md files, it extracts fully qualified URLs and attempts to find schemeless domains.
     * For .json files, it parses the JSON and extracts URLs from string values.
     * For .csv files, it assumes URLs are in the first column.
     * @param fileName - The name of the file (used to determine processing strategy).
     * @param content - The content of the file.
     * @returns A promise that resolves with an array of extracted URLs.
     */
    public async processFileContent(fileName: string, content: string): Promise<string[]> {
        const extractedUrls = new Set<string>();
        const urlRegex = /(https?:\/\/[^\s"]+)/gi;
        const schemelessDomainRegex = /(^|\s|"|')([a-zA-Z0-9-_]+\.)+[a-zA-Z]{2,}(\s|\\"|"|'|$)/g;

        const fqdnMatches = content.match(urlRegex);
        if (fqdnMatches) {
            fqdnMatches.forEach(url => extractedUrls.add(url.trim()));
        }

        if (fileName.endsWith('.txt') || fileName.endsWith('.md')) {
            this.logger.info(`Processing .txt/.md file: ${fileName} for schemeless domains.`);
            const schemelessMatches = content.match(schemelessDomainRegex);
            if (schemelessMatches) {
                schemelessMatches.forEach(domain => {
                    const cleanedDomain = domain.trim().replace(/^["']|["']$/g, '');
                    if (cleanedDomain && !cleanedDomain.includes('://')) {
                        const fullUrl = `https://${cleanedDomain}`;
                        if (!extractedUrls.has(fullUrl)) {
                            extractedUrls.add(fullUrl);
                            this.logger.info(`Found and added schemeless domain as ${fullUrl} from ${fileName}`);
                        }
                    }
                });
            }
        } else if (fileName.endsWith('.json')) {
            this.logger.info(`Processing .json file: ${fileName}`);
            try {
                const jsonData = JSON.parse(content);
                const urlsFromJson = new Set<string>();

                function extractUrlsFromJsonRecursive(data: any) {
                    if (typeof data === 'string') {
                        const jsonStringMatches = data.match(urlRegex);
                        if (jsonStringMatches) {
                            jsonStringMatches.forEach(url => urlsFromJson.add(url.trim()));
                        }
                    } else if (Array.isArray(data)) {
                        data.forEach(item => extractUrlsFromJsonRecursive(item));
                    } else if (typeof data === 'object' && data !== null) {
                        Object.values(data).forEach(value => extractUrlsFromJsonRecursive(value));
                    }
                }

                extractUrlsFromJsonRecursive(jsonData);
                if (urlsFromJson.size > 0) {
                    this.logger.info(`Extracted ${urlsFromJson.size} URLs from parsed JSON structure in ${fileName}`);
                    urlsFromJson.forEach(url => extractedUrls.add(url));
                }
            } catch (e: any) {
                this.logger.warn(`Failed to parse JSON from ${fileName}. Falling back to regex scan of raw content. Error: ${e.message}`);
            }
        } else if (fileName.endsWith('.csv')) {
            this.logger.info(`Processing .csv file: ${fileName}`);
            try {
                const records = parse(content, {
                    columns: false,
                    skip_empty_lines: true,
                });
                for (const record of records) {
                    if (record && record.length > 0 && typeof record[0] === 'string') {
                        const url = record[0].trim();
                        if (url.startsWith('http://') || url.startsWith('https://')) {
                            extractedUrls.add(url);
                        } else if (url) {
                            this.logger.warn(`Skipping invalid or non-HTTP/S URL from CSV content in ${fileName}: "${url}"`);
                        }
                    }
                }
                this.logger.info(`Extracted ${extractedUrls.size} URLs from CSV content in ${fileName} (after initial regex scan)`);
            } catch (e: any) {
                this.logger.warn(`Failed to parse CSV content from ${fileName}. Error: ${e.message}`);
            }
        }
        return Array.from(extractedUrls);
    }

    /**
     * Fetches URLs from a GitHub repository.
     * Can fetch from a repository's root (looking for .txt, .md, .json files) or directly from a file URL.
     * @param repoUrl - The URL of the GitHub repository or a direct file link.
     * @param numUrls - The maximum number of URLs to fetch. If undefined, fetches all found URLs.
     * @returns A promise that resolves with an array of extracted URLs.
     */
    public async fetchUrlsFromGitHub(repoUrl: string, numUrls?: number): Promise<string[]> {
        this.logger.info(`Fetching URLs from GitHub repository source: ${repoUrl}`);
        const allExtractedUrls: string[] = [];

        try {
            if (repoUrl.includes('/blob/')) {
                this.logger.info(`Detected direct file link: ${repoUrl}. Attempting to fetch raw content.`);
                const rawUrl = repoUrl.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
                const fileName = repoUrl.substring(repoUrl.lastIndexOf('/') + 1);

                this.logger.info(`Fetching content directly from raw URL: ${rawUrl}`);
                const fileResponse = await fetch(rawUrl);
                if (fileResponse.ok) {
                    const content = await fileResponse.text();
                    const urlsFromFile = await this.processFileContent(fileName, content);
                    if (urlsFromFile.length > 0) {
                        urlsFromFile.forEach(url => allExtractedUrls.push(url));
                        this.logger.info(`Extracted ${urlsFromFile.length} URLs from ${rawUrl} (direct file)`);
                    } else {
                        this.logger.info(`No URLs found in content from ${rawUrl} (direct file)`);
                    }
                } else {
                    this.logger.error(`Failed to download direct file content: ${rawUrl} - ${fileResponse.status} ${fileResponse.statusText}`);
                    const errorBody = await fileResponse.text();
                    this.logger.error(`Error body: ${errorBody}`);
                    return [];
                }
            } else {
                this.logger.info(`Processing as repository URL: ${repoUrl}`);
                const repoPathMatch = repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
                if (!repoPathMatch || !repoPathMatch[1]) {
                    this.logger.error(`Invalid GitHub repository URL format: ${repoUrl}. Expected format like https://github.com/owner/repo`);
                    return [];
                }
                const repoPath = repoPathMatch[1].replace(/\.git$/, '');
                const contentsUrl = `https://api.github.com/repos/${repoPath}/contents`;
                this.logger.info(`Fetching repository contents from: ${contentsUrl}`);

                const response = await fetch(contentsUrl, {
                    headers: { Accept: 'application/vnd.github.v3+json' },
                });

                if (!response.ok) {
                    this.logger.error(`Failed to fetch repository contents: ${response.status} ${response.statusText}`, { url: contentsUrl });
                    const errorBody = await response.text();
                    this.logger.error(`Error body: ${errorBody}`);
                    return [];
                }

                const files = await response.json() as any[]; // Consider defining a type for GitHub file object
                if (!Array.isArray(files)) {
                    this.logger.error('Expected an array of files from GitHub API, but received something else.', { response: files });
                    return [];
                }

                const targetExtensions = ['.txt', '.md', '.json'];
                this.logger.info(`Found ${files.length} items in the repository. Filtering for ${targetExtensions.join(', ')} files.`);

                for (const file of files) {
                    if (file.type === 'file' && file.name && targetExtensions.some(ext => file.name.endsWith(ext))) {
                        this.logger.info(`Fetching content for file: ${file.path} from ${file.download_url}`);
                        try {
                            const fileResponse = await fetch(file.download_url);
                            if (fileResponse.ok) {
                                const content = await fileResponse.text();
                                const urlsFromFile = await this.processFileContent(file.name, content);
                                if (urlsFromFile.length > 0) {
                                    urlsFromFile.forEach(url => allExtractedUrls.push(url));
                                    this.logger.info(`Extracted ${urlsFromFile.length} URLs from ${file.path}`);
                                }
                            } else {
                                this.logger.warn(`Failed to download file content: ${file.path} - ${fileResponse.status}`);
                            }
                        } catch (fileError: any) {
                            this.logger.error(`Error fetching or processing file ${file.path}: ${fileError.message}`, { fileUrl: file.download_url });
                        }

                        if (numUrls && allExtractedUrls.length >= numUrls) {
                            this.logger.info(`Reached URL limit of ${numUrls}. Stopping further file processing.`);
                            break;
                        }
                    }
                }
            }
            const uniqueUrls = Array.from(new Set(allExtractedUrls));
            this.logger.info(`Total unique URLs extracted before limiting: ${uniqueUrls.length}`);
            return numUrls ? uniqueUrls.slice(0, numUrls) : uniqueUrls;

        } catch (error: any) {
            this.logger.error(`Error processing GitHub URL ${repoUrl}: ${error.message}`, { stack: error.stack });
            return [];
        }
    }
}
