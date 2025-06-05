import * as fs from 'fs';
import * as readline from 'readline';

/**
 * Asynchronously parses a list of URLs from a specified file.
 * Each line in the file is expected to contain one URL.
 * Empty lines or lines with only whitespace are ignored.
 *
 * @param {string} filePath - The path to the input file containing URLs.
 * @returns {Promise<string[]>} A promise that resolves to an array of trimmed URLs.
 * @throws {Error} If the file cannot be found, read, or if any other error occurs during parsing.
 *
 * @example
 * // Assuming 'input.txt' contains:
 * // http://example.com
 * // https://another-example.com
 *
 * import { parsePreloadUrls } from './parser'; // Adjust path as needed
 *
 * async function fetchUrls() {
 *   try {
 *     const urls = await parsePreloadUrls('input.txt');
 *     console.log('Fetched URLs:', urls);
 *     // Expected output:
 *     // Fetched URLs: [ 'http://example.com', 'https://another-example.com' ]
 *   } catch (error) {
 *     console.error('Error fetching URLs:', error.message);
 *   }
 * }
 *
 * fetchUrls();
 */
async function parsePreloadUrls(filePath: string): Promise<string[]> {
    try {
        const loadList: string[] = [];
        const fileStream = fs.createReadStream(filePath);

        // Attach an error handler to the stream to catch issues like file not found
        fileStream.on('error', (err) => {
            throw new Error(`Error reading file ${filePath}: ${err.message}`);
        });

        const urlsRl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        for await (const url of urlsRl) {
            const trimmedUrl: string = url.trim();
            if (trimmedUrl) {
                loadList.push(trimmedUrl);
            }
        }
        return loadList;
    } catch (error) {
        // Re-throw the error to be handled by the caller
        // console.error(`Failed to parse preload URLs from ${filePath}:`, error);
        throw error;
    }
}

// Example usage:
(async () => {
    try {
        const urls = await parsePreloadUrls('src/input.txt');
        console.log("Parsed URLs:", urls);
    } catch (error) {
        console.error("Failed to parse URLs from example usage:", error);
    }
})();