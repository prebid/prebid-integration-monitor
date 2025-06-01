import { promises as fsPromises } from 'fs'; // Renamed to fsPromises for clarity
import * as path from 'path';
import { fileURLToPath } from 'url'; // For robust __dirname

// Replicate __dirname functionality for ES modules
const __filename: string = fileURLToPath(import.meta.url);
const __dirname: string = path.dirname(__filename);

const outputDir: string = path.join(__dirname, '..', 'store');
const finalApiFilePath: string = path.join(__dirname, '..', '..', 'api', 'api.json'); // Changed from summaryFilePath
const MIN_COUNT_THRESHOLD: number = 5; // Added from clean_stats.ts

// Interfaces from update_stats.ts (SiteData, PrebidInstanceData remain the same)
interface SiteData {
    url?: string;
    prebidInstances?: PrebidInstanceData[];
}

interface PrebidInstanceData {
    version?: string;
    modules?: string[];
}

// Interfaces that were in clean_stats.ts or are combined
interface VersionDistribution { // From clean_stats.ts - used for categorized versions
    [version: string]: number;
}

interface ModuleDistribution { // From clean_stats.ts - used for categorized modules
    [moduleName: string]: number;
}

// This is the structure of the data after initial summarization
interface SummarizationData { // Was SummaryData in update_stats.ts and SummarizationData in clean_stats.ts
    visitedSites: number; // Added from clean_stats.ts, was monitoredSites
    monitoredSites: number; // Kept from update_stats.ts
    prebidSites: number;
    versionDistribution: VersionDistribution; // This will be the raw versions before categorization
    moduleDistribution: ModuleDistribution; // This will be the raw modules before filtering/categorization
}

// This is the final output structure, similar to OutputData in clean_stats.ts
interface FinalApiData {
    visitedSites: number;
    monitoredSites: number;
    prebidSites: number;
    releaseVersions: VersionDistribution;
    buildVersions: VersionDistribution;
    customVersions: VersionDistribution;
    bidAdapterInst: ModuleDistribution;
    idModuleInst: ModuleDistribution;
    rtdModuleInst: ModuleDistribution;
    analyticsAdapterInst: ModuleDistribution;
    otherModuleInst: ModuleDistribution;
}

// Version parsing and comparison functions from update_stats.ts (kept as they are more detailed)
interface VersionComponents {
    major: number;
    minor: number;
    patch: number;
    preRelease: string | null;
}

function parseVersion(versionString: string | undefined): VersionComponents {
    if (!versionString) {
        console.warn(`Attempted to parse null or undefined version string.`);
        return { major: 0, minor: 0, patch: 0, preRelease: 'invalid' };
    }
    const match: RegExpMatchArray | null = versionString.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
    if (!match) {
        console.warn(`Could not parse version: ${versionString}`);
        return { major: 0, minor: 0, patch: 0, preRelease: versionString };
    }
    return {
        major: parseInt(match[1], 10),
        minor: parseInt(match[2], 10),
        patch: parseInt(match[3], 10),
        preRelease: match[4] || null,
    };
}

function compareVersions(a: string, b: string): number {
    const vA: VersionComponents = parseVersion(a);
    const vB: VersionComponents = parseVersion(b);

    if (vA.major !== vB.major) return vB.major - vA.major;
    if (vA.minor !== vB.minor) return vB.minor - vA.minor;
    if (vA.patch !== vB.patch) return vB.patch - vA.patch;

    if (vA.preRelease === null && vB.preRelease !== null) return -1;
    if (vA.preRelease !== null && vB.preRelease === null) return 1;

    if (vA.preRelease && vB.preRelease) {
        if (vA.preRelease < vB.preRelease) return -1;
        if (vA.preRelease > vB.preRelease) return 1;
    }
    return 0;
}

interface UpdateStatsOptions {
  logError?: (message: string, errorName: string, errorMessage: string) => void;
}

/**
 * Main function to summarize and then clean statistics.
 */
async function updateAndCleanStats(options?: UpdateStatsOptions): Promise<void> {
    // Part 1: Summarization (adapted from original summarizeStats in update_stats.ts)
    const rawVersionCounts: VersionDistribution = {}; // Was versionCounts
    const rawModuleCounts: ModuleDistribution = {}; // Was moduleCounts
    const uniqueUrls: Set<string> = new Set();
    const urlsWithPrebid: Set<string> = new Set();
    const monthAbbrRegex: RegExp = /^[A-Z][a-z]{2}$/;

    try {
        const outputEntries: import('fs').Dirent[] = await fsPromises.readdir(outputDir, { withFileTypes: true });

        for (const entry of outputEntries) {
            if (entry.isDirectory() && monthAbbrRegex.test(entry.name)) {
                const monthDirPath: string = path.join(outputDir, entry.name);
                const files: string[] = await fsPromises.readdir(monthDirPath);

                for (const file of files) {
                    // console.log(`TEMPORARY DEBUG: Processing file: ${path.join(monthDirPath, file)}`); // Restore
                    if (path.extname(file).toLowerCase() === '.json') {
                        const filePath: string = path.join(monthDirPath, file);
                        try {
                            const fileContent: string = await fsPromises.readFile(filePath, 'utf8');
                            // console.log(`TEMPORARY DEBUG: Content of ${filePath}: ###${fileContent}###`); // Restore

                            // Removed temporary diagnostic block for invalid.json

                            const siteEntries: SiteData[] = JSON.parse(fileContent); // Renamed for clarity

                            if (Array.isArray(siteEntries)) {
                                siteEntries.forEach((siteData: SiteData) => {
                                    const currentUrl: string | undefined = siteData?.url?.trim();
                                    let hasPrebidInstance: boolean = false;

                                    if (currentUrl) {
                                        uniqueUrls.add(currentUrl);
                                    }

                                    if (Array.isArray(siteData.prebidInstances)) {
                                        siteData.prebidInstances.forEach((instance: PrebidInstanceData) => {
                                            if (instance) {
                                                hasPrebidInstance = true;

                                                if (typeof instance.version === 'string') {
                                                    const version: string = instance.version.trim();
                                                    if (version) {
                                                        rawVersionCounts[version] = (rawVersionCounts[version] || 0) + 1;
                                                    }
                                                }

                                                if (Array.isArray(instance.modules)) {
                                                    instance.modules.forEach((moduleName: string) => {
                                                        if (typeof moduleName === 'string') {
                                                            const trimmedModule: string = moduleName.trim();
                                                            if (trimmedModule) {
                                                                rawModuleCounts[trimmedModule] = (rawModuleCounts[trimmedModule] || 0) + 1;
                                                            }
                                                        }
                                                    });
                                                }
                                            }
                                        });
                                    }
                                    if (currentUrl && hasPrebidInstance) {
                                        urlsWithPrebid.add(currentUrl);
                                    }
                                });
                            }
                        } catch (parseError: any) {
                            const errorMessage = `Error parsing JSON file ${filePath}:`;
                            if (options?.logError) {
                                options.logError(errorMessage, parseError.name, parseError.message);
                            } else {
                                // console.log('TEMPORARY DEBUG: Entered catch block for parseError in update_stats.ts. Error message:', parseError.message); // Restore
                                console.error(errorMessage, parseError); // Restore original error logging
                            }
                        }
                    }
                }
            }
        }

        const sortedRawVersions: string[] = Object.keys(rawVersionCounts).sort(compareVersions);
        const sortedRawVersionCounts: VersionDistribution = {};
        for (const version of sortedRawVersions) {
            sortedRawVersionCounts[version] = rawVersionCounts[version];
        }

        const sortedRawModules: string[] = Object.keys(rawModuleCounts).sort((a, b) => rawModuleCounts[b] - rawModuleCounts[a]);
        const sortedRawModuleCounts: ModuleDistribution = {};
        for (const moduleName of sortedRawModules) {
            sortedRawModuleCounts[moduleName] = rawModuleCounts[moduleName];
        }

        const summarizationData: SummarizationData = {
            visitedSites: uniqueUrls.size, // This now correctly represents all sites found in logs
            monitoredSites: uniqueUrls.size, // Keeping monitoredSites as per original update_stats, perhaps it means the same
            prebidSites: urlsWithPrebid.size,
            versionDistribution: sortedRawVersionCounts,
            moduleDistribution: sortedRawModuleCounts,
        };

        // Part 2: Cleaning (adapted from cleanStats in clean_stats.ts)
        const finalApiData: FinalApiData = {
            visitedSites: summarizationData.visitedSites,
            monitoredSites: summarizationData.monitoredSites,
            prebidSites: summarizationData.prebidSites,
            releaseVersions: {},
            buildVersions: {},
            customVersions: {},
            bidAdapterInst: {},
            idModuleInst: {},
            rtdModuleInst: {},
            analyticsAdapterInst: {},
            otherModuleInst: {}
        };

        // Process versionDistribution from summarizationData
        const versionDistributionForCleaning: VersionDistribution = summarizationData.versionDistribution;
        for (const version in versionDistributionForCleaning) {
            const count: number = versionDistributionForCleaning[version];
            const cleanedVersion: string = version.startsWith('v') ? version.substring(1) : version;

            if (version.endsWith('-pre')) {
                finalApiData.buildVersions[cleanedVersion] = count;
            } else if (version.includes('-')) { // Covers cases like '1.2.3-custom' or 'v1.2.3-custom'
                finalApiData.customVersions[cleanedVersion] = count;
            } else {
                if (cleanedVersion.includes('.')) { // Standard X.Y.Z or X.Y
                    finalApiData.releaseVersions[cleanedVersion] = count;
                } else { // Single numbers or other non-standard, treat as custom
                    finalApiData.customVersions[cleanedVersion] = count;
                }
            }
        }

        // Process moduleDistribution from summarizationData
        const moduleDistributionForCleaning: ModuleDistribution = summarizationData.moduleDistribution;
        for (const moduleName in moduleDistributionForCleaning) {
            const count: number = moduleDistributionForCleaning[moduleName];

            if (count < MIN_COUNT_THRESHOLD) {
                continue;
            }

            if (moduleName.includes('BidAdapter')) {
                finalApiData.bidAdapterInst[moduleName] = count;
            } else if (moduleName.includes('IdSystem') || moduleName === 'userId' || moduleName === 'idImportLibrary' || moduleName === 'pubCommonId' || moduleName === 'utiqSystem' || moduleName === 'trustpidSystem') {
                finalApiData.idModuleInst[moduleName] = count;
            } else if (moduleName.includes('RtdProvider') || moduleName === 'rtdModule') {
                finalApiData.rtdModuleInst[moduleName] = count;
            } else if (moduleName.includes('AnalyticsAdapter')) {
                finalApiData.analyticsAdapterInst[moduleName] = count;
            } else {
                finalApiData.otherModuleInst[moduleName] = count;
            }
        }

        // Ensure the target directory exists before writing
        const targetApiDir = path.dirname(finalApiFilePath);
        try {
            await fsPromises.access(targetApiDir);
        } catch (error) {
            await fsPromises.mkdir(targetApiDir, { recursive: true });
        }

        // Write the final cleaned data to api.json
        await fsPromises.writeFile(finalApiFilePath, JSON.stringify(finalApiData, null, 2));
        console.log(`Successfully created ${finalApiFilePath}`);

    } catch (err: any) {
        const errorMessage = 'Error processing stats:';
        if (options?.logError) {
            options.logError(errorMessage, err.name, err.message);
        } else {
            console.error(errorMessage, err); // Changed error message for broader scope
        }
    }
}

// Run the function
// updateAndCleanStats(); // Commented out: This should not run on import for testing

// If you need to export the function:
export { updateAndCleanStats };
