import fetch from 'node-fetch';
import { writeFile } from 'fs/promises'; // Use promises for async/await with fs

/**
 * Fetches a JSON file from a GitHub URL, extracts URLs from a specific key,
 * and writes them to a new file.
 *
 * @param {string} githubFileUrl - The URL to the file page on GitHub (e.g., https://github.com/...)
 * @param {string} outputFilePath - The path for the new file to write URLs to (e.g., 'output_urls.txt').
 * @param {string} urlKey - The key within the JSON objects that holds the URL value. Defaults to 'url'.
 */
async function extractUrlsFromGithubJson(githubFileUrl, outputFilePath, urlKey = 'url') {
    console.log(`Starting URL extraction from: ${githubFileUrl}`);

    // --- 1. Convert GitHub page URL to Raw Content URL ---
    let rawUrl;
    try {
        // Try parsing as a standard GitHub blob URL
        const githubRepoRegex = /github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.*)/;
        const match = githubFileUrl.match(githubRepoRegex);

        if (match) {
            const [, owner, repo, branch, filePath] = match;
            rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
            console.log(`Converted to raw content URL: ${rawUrl}`);
        } else if (githubFileUrl.startsWith('https://raw.githubusercontent.com/')) {
             // It might already be a raw URL
             rawUrl = githubFileUrl;
             console.log(`Input is already a raw content URL: ${rawUrl}`);
        }
         else {
            throw new Error('Invalid GitHub URL format provided. Expected format like https://github.com/user/repo/blob/branch/path/to/file.json');
        }
    } catch (error) {
        console.error("Error determining raw URL:", error.message);
        return; // Stop execution if URL is invalid
    }


    try {
        // --- 2. Fetch the JSON data ---
        console.log(`Workspaceing data from ${rawUrl}...`);
        const response = await fetch(rawUrl);

        if (!response.ok) {
            // Throw an error if the request failed (e.g., 404 Not Found)
            throw new Error(`HTTP error fetching file: ${response.status} ${response.statusText}`);
        }

        // --- 3. Parse the JSON response ---
        console.log("Parsing JSON data...");
        const jsonData = await response.json(); // Automatically parses the response body as JSON

        // --- 4. Extract URLs ---
        // Assuming the JSON is an array of objects, and each object has a key specified by urlKey
        if (!Array.isArray(jsonData)) {
            throw new Error(`Expected JSON data to be an array, but got ${typeof jsonData}`);
        }

        console.log(`Extracting URLs using key: '${urlKey}'...`);
        const urls = jsonData
            .map(item => item && typeof item === 'object' ? item[urlKey] : undefined) // Safely access the key
            .filter(urlValue => typeof urlValue === 'string' && urlValue.trim().length > 0); // Keep only valid, non-empty string URLs

        if (urls.length === 0) {
            console.warn(`No URLs found using the key '${urlKey}' in the fetched JSON data.`);
            // Optionally write an empty file or just exit
            // await writeFile(outputFilePath, '', 'utf8');
            // console.log(`Wrote empty file to ${outputFilePath}`);
            return;
        }

        // --- 5. Write URLs to the output file ---
        console.log(`Writing ${urls.length} URLs to ${outputFilePath}...`);
        const fileContent = urls.join('\n'); // Join URLs with newline characters
        await writeFile(outputFilePath, fileContent, 'utf8'); // Write asynchronously

        console.log(`Successfully extracted ${urls.length} URLs and saved them to ${outputFilePath}`);

    } catch (error) {
        console.error("An error occurred during the process:");
        if (error instanceof SyntaxError) {
            console.error(" -> Failed to parse JSON. The fetched content might not be valid JSON.");
        } else if (error.code === 'ENOENT') {
             console.error(" -> File system error: Could not write the output file. Check if the directory exists and you have permissions.");
        } else {
            console.error(` -> ${error.message}`);
        }
         // console.error(error); // Uncomment for full stack trace if needed
    }
}

// --- How to Use ---
const inputFileUrl = 'https://github.com/prebid/prebid-integration-monitor/blob/main/output/results.json';
const outputFile = 'extracted_urls.txt'; // The name of the file to create

// Call the function
extractUrlsFromGithubJson(inputFileUrl, outputFile);
