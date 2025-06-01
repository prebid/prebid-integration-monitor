import * as fs from 'fs'; // Changed to import * as fs
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
// Replicate __dirname functionality in ES Modules
const __filename = fileURLToPath(import.meta.url); // No changes needed here
const __dirname = dirname(__filename);
const outputDir = path.join(__dirname, '..', 'output');
const summaryFilePath = path.join(outputDir, 'summarization.json'); // No changes needed here
/**
 * Parses a version string (e.g., "v9.30.0", "v9.31.0-pre") into components.
 * @param {string} versionString
 * @returns {VersionComponents}
 */
function parseVersion(versionString) {
    // Added robustness: handle potential null/undefined input
    if (!versionString) {
        console.warn(`Attempted to parse null or undefined version string.`);
        return { major: 0, minor: 0, patch: 0, preRelease: 'invalid' };
    }
    const match = versionString.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
    if (!match) {
        // Handle non-standard versions or return a default low value
        console.warn(`Could not parse version: ${versionString}`);
        // Return a structure that allows comparison but marks it as non-standard
        return { major: 0, minor: 0, patch: 0, preRelease: versionString };
    }
    return {
        major: parseInt(match[1], 10),
        minor: parseInt(match[2], 10),
        patch: parseInt(match[3], 10),
        preRelease: match[4] || null,
    };
}
/**
 * Compares two version strings based on semantic versioning rules (descending order).
 * @param {string} a Version string a
 * @param {string} b Version string b
 * @returns {number} -1 if a > b, 1 if a < b, 0 if a === b
 */
function compareVersions(a, b) {
    const vA = parseVersion(a);
    const vB = parseVersion(b);
    if (vA.major !== vB.major)
        return vB.major - vA.major;
    if (vA.minor !== vB.minor)
        return vB.minor - vA.minor;
    if (vA.patch !== vB.patch)
        return vB.patch - vA.patch;
    // Versions without pre-release tags are considered newer
    if (vA.preRelease === null && vB.preRelease !== null)
        return -1;
    if (vA.preRelease !== null && vB.preRelease === null)
        return 1;
    // If both have pre-release tags, compare them lexicographically (ascending)
    if (vA.preRelease && vB.preRelease) {
        if (vA.preRelease < vB.preRelease)
            return -1; // a comes before b
        if (vA.preRelease > vB.preRelease)
            return 1; // a comes after b
    }
    return 0; // Versions are identical or only differ in ways not covered (e.g., build metadata)
}
/**
 * Extracts data from monthly JSON files and summarizes Prebid version distribution,
 * module distribution, total monitored sites, and sites with Prebid detected.
 * Assumes version information is located at `entry.prebidInstances[].version`.
 * Assumes module information is located at `entry.prebidInstances[].modules`.
 * Assumes URL information is located at `entry.url`.
 */
async function summarizeStats() {
    const versionCounts = {};
    const moduleCounts = {}; // Added to count modules
    const uniqueUrls = new Set(); // Use a Set to store all unique URLs found
    const urlsWithPrebid = new Set(); // Use a Set to store unique URLs with Prebid
    const monthAbbrRegex = /^[A-Z][a-z]{2}$/; // Matches month abbreviations like Apr, Feb, Mar
    try {
        const outputEntries = await fs.promises.readdir(outputDir, { withFileTypes: true }); // Changed fsPromises to fs.promises
        for (const entry of outputEntries) {
            // Process only directories matching the month abbreviation pattern
            if (entry.isDirectory() && monthAbbrRegex.test(entry.name)) {
                const monthDirPath = path.join(outputDir, entry.name);
                const files = await fs.promises.readdir(monthDirPath); // Changed fsPromises to fs.promises
                for (const file of files) {
                    if (path.extname(file).toLowerCase() === '.json') {
                        const filePath = path.join(monthDirPath, file);
                        try {
                            const fileContent = await fs.promises.readFile(filePath, 'utf8'); // Changed fsPromises to fs.promises
                            const data = JSON.parse(fileContent);
                            if (Array.isArray(data)) {
                                data.forEach((siteData) => {
                                    const currentUrl = siteData?.url?.trim();
                                    let hasPrebidInstance = false; // No changes needed here
                                    // Count unique URLs
                                    if (currentUrl) {
                                        uniqueUrls.add(currentUrl);
                                    }
                                    // Process Prebid instances
                                    if (Array.isArray(siteData.prebidInstances)) {
                                        siteData.prebidInstances.forEach((instance) => {
                                            if (instance) {
                                                hasPrebidInstance = true; // Mark site as having Prebid if any instance exists
                                                // Count versions
                                                if (typeof instance.version === 'string') {
                                                    const version = instance.version.trim();
                                                    if (version) {
                                                        versionCounts[version] = (versionCounts[version] || 0) + 1;
                                                    }
                                                }
                                                // --- Assumption: Modules are in instance.modules array ---
                                                if (Array.isArray(instance.modules)) {
                                                    instance.modules.forEach((moduleName) => {
                                                        if (typeof moduleName === 'string') {
                                                            const trimmedModule = moduleName.trim();
                                                            if (trimmedModule) {
                                                                moduleCounts[trimmedModule] = (moduleCounts[trimmedModule] || 0) + 1;
                                                            }
                                                        }
                                                    });
                                                }
                                                // --- End Module Assumption ---
                                            }
                                        });
                                    }
                                    // If the site had a URL and at least one Prebid instance, add URL to the set
                                    if (currentUrl && hasPrebidInstance) {
                                        urlsWithPrebid.add(currentUrl);
                                    }
                                });
                            }
                        }
                        catch (parseError) {
                            console.error(`Error parsing JSON file ${filePath}:`, parseError);
                        }
                    }
                }
            }
        }
        // Sort the versions (descending semantic version)
        const sortedVersions = Object.keys(versionCounts).sort(compareVersions);
        const sortedVersionCounts = {};
        for (const version of sortedVersions) {
            sortedVersionCounts[version] = versionCounts[version];
        }
        // Sort the modules (descending count)
        const sortedModules = Object.keys(moduleCounts).sort((a, b) => moduleCounts[b] - moduleCounts[a]);
        const sortedModuleCounts = {};
        for (const moduleName of sortedModules) {
            sortedModuleCounts[moduleName] = moduleCounts[moduleName];
        }
        // Prepare the summary object
        const summaryData = {
            monitoredSites: uniqueUrls.size,
            prebidSites: urlsWithPrebid.size,
            versionDistribution: sortedVersionCounts,
            moduleDistribution: sortedModuleCounts, // Add sorted module counts
        };
        // Write the summary to summarization.json
        await fs.promises.writeFile(summaryFilePath, JSON.stringify(summaryData, null, 2)); // Changed fsPromises to fs.promises
        console.log(`Summary successfully written to ${summaryFilePath}`);
    }
    catch (err) {
        console.error('Error processing output directories:', err);
    }
}
// Example usage: Call the function
summarizeStats();
// If you need to export the function:
// export { summarizeStats };
