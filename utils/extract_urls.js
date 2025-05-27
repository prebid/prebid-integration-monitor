import { promises as fs } from 'fs';
import path from 'path';

// Define the base directory for your output files and the name of the output text file.
// Assuming 'extract_urls.js' is in the root of your 'prebid-integration-monitor' project.
// If it's in a 'scripts' subdirectory, you might change baseOutputDir to '../output'.
const baseOutputDir = './output';
const storeDirPath = './store'; // Directory to store individual month files

/**
 * Extracts URLs from JSON files that contain a 'prebidInstances' array,
 * groups them by month, and writes them to separate text files per month
 * in the 'store' directory.
 */
async function extractAndWriteUrlsByMonth() {
    const urlsByMonth = {};
    let महीनेFolders;

    try {
        महीनेFolders = await fs.readdir(baseOutputDir, { withFileTypes: true });
    } catch (error) {
        console.error(`Error reading base output directory ${baseOutputDir}:`, error);
        return;
    }

    const monthDirectoryNames = महीनेFolders
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

    console.log(`Found month folders: ${monthDirectoryNames.join(', ')}`);

    for (const monthName of monthDirectoryNames) {
        const monthPath = path.join(baseOutputDir, monthName);
        urlsByMonth[monthName] = new Set(); // Use a Set to automatically handle duplicate URLs within the same month

        let dailyFiles;
        try {
            dailyFiles = await fs.readdir(monthPath, { withFileTypes: true });
        } catch (error) {
            console.error(`Error reading month directory ${monthPath}:`, error);
            continue; // Skip to the next month
        }

        const jsonFileNames = dailyFiles
            .filter(dirent => dirent.isFile() && dirent.name.endsWith('.json'))
            .map(dirent => dirent.name);

        if (jsonFileNames.length === 0) {
            console.log(`No JSON files found in ${monthPath}`);
            continue;
        }

        console.log(`Processing files in ${monthPath}: ${jsonFileNames.join(', ')}`);

        for (const jsonFileName of jsonFileNames) {
            const filePath = path.join(monthPath, jsonFileName);
            try {
                const fileContent = await fs.readFile(filePath, 'utf-8');
                const dataArray = JSON.parse(fileContent);

                if (!Array.isArray(dataArray)) {
                    console.warn(`Warning: Content of ${filePath} is not an array. Skipping.`);
                    continue;
                }

                for (const item of dataArray) {
                    if (item && item.prebidInstances && Array.isArray(item.prebidInstances) && item.prebidInstances.length > 0 && item.url) {
                        urlsByMonth[monthName].add(item.url);
                    }
                }
            } catch (parseError) {
                console.error(`Error parsing JSON from file ${filePath}:`, parseError);
            }
        }
    }

    // Ensure the store directory exists
    try {
        await fs.mkdir(storeDirPath, { recursive: true });
        console.log(`Ensured 'store' directory exists at ${storeDirPath}`);
    } catch (mkdirError) {
        console.error(`Error creating store directory ${storeDirPath}:`, mkdirError);
        return; // Stop if we can't create the output directory
    }

    let anyUrlsWritten = false;
    const sortedMonths = Object.keys(urlsByMonth).sort(); // Sort months for consistent output

    for (const month of sortedMonths) {
        if (urlsByMonth[month].size > 0) {
            const monthFilePath = path.join(storeDirPath, `${month}.txt`);
            const urlsForMonth = Array.from(urlsByMonth[month]);
            const fileContent = urlsForMonth.join('\n') + '\n'; // Add a newline at the end

            try {
                await fs.writeFile(monthFilePath, fileContent);
                console.log(`Successfully extracted URLs for ${month} to ${monthFilePath}`);
                anyUrlsWritten = true;
            } catch (writeError) {
                console.error(`Error writing to output file ${monthFilePath}:`, writeError);
            }
        } else {
            console.log(`No URLs with prebidInstances found for month: ${month}`);
        }
    }

    if (!anyUrlsWritten) {
        console.log('No URLs with prebidInstances found across all months to write to files.');
    }
}

// Run the function
extractAndWriteUrlsByMonth().catch(error => {
    console.error("An unexpected error occurred:", error);
});
