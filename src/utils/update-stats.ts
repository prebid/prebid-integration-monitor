import { promises as fsPromises } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const __filename: string = fileURLToPath(import.meta.url);
const __dirname: string = path.dirname(__filename);

const outputDir: string = path.join(__dirname, '..', 'store');
const finalApiFilePath: string = path.join(__dirname, '..', '..', 'api', 'api.json');
const MIN_COUNT_THRESHOLD: number = 5;

/**
 * Represents data collected from a single website during a scan.
 * @interface SiteData
 */
interface SiteData {
    /** @property {string} [url] - The URL of the website. Optional, but expected in practice. */
    url?: string;
    /** @property {PrebidInstanceData[]} [prebidInstances] - An array of Prebid.js instances found on the site. Optional if no instances detected. */
    prebidInstances?: PrebidInstanceData[];
}

/**
 * Represents data for a single Prebid.js instance found on a website.
 * @interface PrebidInstanceData
 */
interface PrebidInstanceData {
    /** @property {string} [version] - The version of the Prebid.js instance (e.g., "8.42.0", "v7.53.0-pre"). Optional if version couldn't be determined. */
    version?: string;
    /** @property {string[]} [modules] - An array of module names (e.g., "rubiconBidAdapter", "userId") associated with the Prebid.js instance. Optional if no modules detected or applicable. */
    modules?: string[];
}

/**
 * Represents a distribution map where keys are item names (versions or module names)
 * and values are their corresponding counts.
 * @typedef {Object<string, number>} DistributionMap
 */

/**
 * Represents the distribution of Prebid.js versions.
 * The keys are version strings (e.g., "8.42.0") and values are their counts.
 * @typedef {DistributionMap} VersionDistribution
 */
interface VersionDistribution {
    [version: string]: number;
}

/**
 * Represents the distribution of Prebid.js modules.
 * The keys are module names (e.g., "rubiconBidAdapter") and values are their counts.
 * @typedef {DistributionMap} ModuleDistribution
 */
interface ModuleDistribution {
    [moduleName: string]: number;
}

/**
 * Represents the final aggregated API data structure that is written to a JSON file.
 * This data summarizes Prebid.js usage statistics across all scanned websites.
 * @interface FinalApiData
 */
interface FinalApiData {
    /** @property {number} visitedSites - Total number of unique websites visited by the scanner. */
    visitedSites: number;
    /** @property {number} monitoredSites - Total number of websites monitored (currently equivalent to visitedSites). */
    monitoredSites: number;
    /** @property {number} prebidSites - Total number of unique websites where at least one Prebid.js instance was detected. */
    prebidSites: number;
    /** @property {VersionDistribution} releaseVersions - Distribution of official release versions of Prebid.js (e.g., "8.42.0"). */
    releaseVersions: VersionDistribution;
    /** @property {VersionDistribution} buildVersions - Distribution of build versions of Prebid.js (e.g., "8.42.0-pre", identified by "-pre" suffix). */
    buildVersions: VersionDistribution;
    /** @property {VersionDistribution} customVersions - Distribution of custom or non-standard versions of Prebid.js (e.g., "8.42.0-custom", or versions not matching x.y.z pattern). */
    customVersions: VersionDistribution;
    /** @property {ModuleDistribution} bidAdapterInst - Distribution of Prebid.js bid adapter module instances. */
    bidAdapterInst: ModuleDistribution;
    /** @property {ModuleDistribution} idModuleInst - Distribution of Prebid.js ID system module instances. */
    idModuleInst: ModuleDistribution;
    /** @property {ModuleDistribution} rtdModuleInst - Distribution of Prebid.js Real-Time Data (RTD) module instances. */
    rtdModuleInst: ModuleDistribution;
    /** @property {ModuleDistribution} analyticsAdapterInst - Distribution of Prebid.js analytics adapter module instances. */
    analyticsAdapterInst: ModuleDistribution;
    /** @property {ModuleDistribution} otherModuleInst - Distribution of other Prebid.js module instances not fitting into the above categories. */
    otherModuleInst: ModuleDistribution;
    /** @property {ModuleDistribution} [bidAdapterWebsites] - Distribution of unique websites using specific bid adapter modules. Optional. */
    bidAdapterWebsites?: ModuleDistribution;
    /** @property {ModuleDistribution} [idModuleWebsites] - Distribution of unique websites using specific ID system modules. Optional. */
    idModuleWebsites?: ModuleDistribution;
    /** @property {ModuleDistribution} [rtdModuleWebsites] - Distribution of unique websites using specific RTD modules. Optional. */
    rtdModuleWebsites?: ModuleDistribution;
    /** @property {ModuleDistribution} [analyticsAdapterWebsites] - Distribution of unique websites using specific analytics adapter modules. Optional. */
    analyticsAdapterWebsites?: ModuleDistribution;
    /** @property {ModuleDistribution} [otherModuleWebsites] - Distribution of unique websites using other specific Prebid.js modules. Optional. */
    otherModuleWebsites?: ModuleDistribution;
}

/**
 * Represents the individual components of a parsed semantic version string.
 * @interface VersionComponents
 * @see {@link https://semver.org/ Semantic Versioning}
 */
interface VersionComponents {
    /** @property {number} major - The major version number. */
    major: number;
    /** @property {number} minor - The minor version number. */
    minor: number;
    /** @property {number} patch - The patch version number. */
    patch: number;
    /** @property {string|null} preRelease - The pre-release identifier (e.g., 'alpha', 'beta', 'pre.1'), or null if it's a release version. */
    preRelease: string | null;
}

/**
 * Parses a Prebid.js version string (potentially with a 'v' prefix and pre-release suffix)
 * into its major, minor, patch, and pre-release components.
 *
 * @param {string | undefined} versionString - The version string to parse. Examples: "7.53.0", "v8.1.0-pre", "9.0.0-alpha.1".
 * @returns {VersionComponents} An object containing the parsed version components.
 * If `versionString` is null, undefined, or cannot be parsed:
 *  - For null/undefined input, returns `{ major: 0, minor: 0, patch: 0, preRelease: 'invalid' }`.
 *  - For unparseable strings, returns `{ major: 0, minor: 0, patch: 0, preRelease: originalInputString }`.
 * @example
 * parseVersion("v8.42.0-pre.1"); // returns { major: 8, minor: 42, patch: 0, preRelease: "pre.1" }
 * parseVersion("7.53.0");    // returns { major: 7, minor: 53, patch: 0, preRelease: null }
 * parseVersion(undefined);   // returns { major: 0, minor: 0, patch: 0, preRelease: "invalid" }
 * parseVersion("beta");      // returns { major: 0, minor: 0, patch: 0, preRelease: "beta" }
 */
function parseVersion(versionString: string | undefined): VersionComponents {
    if (!versionString) {
        // console.warn(`Attempted to parse null or undefined version string.`); // Keep console.warn for ops debugging if needed
        return { major: 0, minor: 0, patch: 0, preRelease: 'invalid' };
    }
    // Regex to capture: optional 'v', major, minor, patch, and optional pre-release suffix
    const match: RegExpMatchArray | null = versionString.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
    if (!match) {
        // console.warn(`Could not parse version: ${versionString}`); // Keep console.warn for ops debugging
        return { major: 0, minor: 0, patch: 0, preRelease: versionString }; // Return original string as preRelease if parsing fails
    }
    return {
        major: parseInt(match[1], 10),
        minor: parseInt(match[2], 10),
        patch: parseInt(match[3], 10),
        preRelease: match[4] || null,
    };
}

/**
 * Configuration object for categorizing modules.
 * Each key represents a category, and its value is a function that takes a module name
 * and returns true if the module belongs to that category.
 */
const defaultModuleCategories = {
  bidAdapter: (name: string): boolean => name.includes('BidAdapter'),
  idModule: (name: string): boolean => name.includes('IdSystem') || ['userId', 'idImportLibrary', 'pubCommonId', 'utiqSystem', 'trustpidSystem'].includes(name),
  rtdModule: (name: string): boolean => name.includes('RtdProvider') || name === 'rtdModule',
  analyticsAdapter: (name: string): boolean => name.includes('AnalyticsAdapter'),
};

/**
 * @typedef {object} CategorizedModules
 * @property {ModuleDistribution} bidAdapter - Distribution of bid adapter modules.
 * @property {ModuleDistribution} idModule - Distribution of ID system modules.
 * @property {ModuleDistribution} rtdModule - Distribution of RTD modules.
 * @property {ModuleDistribution} analyticsAdapter - Distribution of analytics adapter modules.
 * @property {ModuleDistribution} other - Distribution of modules not fitting other categories.
 */

/**
 * Generic function to categorize modules from a data source based on extracted counts and category predicates.
 *
 * @template T
 * @param {{ [moduleName: string]: T }} dataSource - The source of module data (e.g., raw counts, sets of websites).
 * @param {number} MIN_COUNT_THRESHOLD - The minimum count (extracted by `countExtractor`) for a module to be included.
 * @param {(item: T) => number} countExtractor - A function that extracts the numerical count from an item in `dataSource`.
 * @param {typeof defaultModuleCategories} moduleCategoryPredicates - An object mapping category names to predicate functions
 * that determine if a module name belongs to that category.
 * @returns {CategorizedModules} An object containing modules categorized into distributions.
 */
function _categorizeModules<T>(
    dataSource: { [moduleName: string]: T },
    MIN_COUNT_THRESHOLD: number,
    countExtractor: (item: T) => number,
    moduleCategoryPredicates: typeof defaultModuleCategories
): {
    bidAdapter: ModuleDistribution;
    idModule: ModuleDistribution;
    rtdModule: ModuleDistribution;
    analyticsAdapter: ModuleDistribution;
    other: ModuleDistribution;
} {
    const result = {
        bidAdapter: {} as ModuleDistribution,
        idModule: {} as ModuleDistribution,
        rtdModule: {} as ModuleDistribution,
        analyticsAdapter: {} as ModuleDistribution,
        other: {} as ModuleDistribution,
    };

    for (const moduleName in dataSource) {
        const count = countExtractor(dataSource[moduleName]);

        if (count < MIN_COUNT_THRESHOLD) {
            continue;
        }

        let categorized = false;
        for (const categoryKey in moduleCategoryPredicates) {
            const key = categoryKey as keyof typeof defaultModuleCategories;
            if (moduleCategoryPredicates[key](moduleName)) {
                result[key][moduleName] = count;
                categorized = true;
                break;
            }
        }

        if (!categorized) {
            result.other[moduleName] = count;
        }
    }
    return result;
}


/**
 * Defines the structure for the return type of {@link processModuleWebsiteCounts}.
 * @typedef {object} ProcessedModuleWebsiteCounts
 * @property {ModuleDistribution} bidAdapterWebsites - Distribution of websites using specific bid adapters.
 * @property {ModuleDistribution} idModuleWebsites - Distribution of websites using specific ID system modules.
 * @property {ModuleDistribution} rtdModuleWebsites - Distribution of websites using specific RTD modules.
 * @property {ModuleDistribution} analyticsAdapterWebsites - Distribution of websites using specific analytics adapter modules.
 * @property {ModuleDistribution} otherModuleWebsites - Distribution of websites using other specific modules.
 */

/**
 * Filters and categorizes modules based on the number of unique websites they appear on.
 * Modules are counted per website, so if a module appears on many websites, it gets a high count.
 * This version uses the generic `_categorizeModules` helper.
 *
 * @param {{ [moduleName: string]: Set<string> }} moduleWebsiteData - An object where keys are module names
 * and values are Sets of unique website URLs where the respective module is found.
 * @param {number} MIN_COUNT_THRESHOLD - The minimum number of unique websites a module must appear on
 * to be included in the final distributions.
 * @returns {ProcessedModuleWebsiteCounts} An object containing categorized module distributions based on website counts.
 * @remarks This function helps identify widely adopted modules across different websites.
 */
function processModuleWebsiteCounts(
    moduleWebsiteData: { [moduleName: string]: Set<string> },
    MIN_COUNT_THRESHOLD: number
): { // Matches the ProcessedModuleWebsiteCounts typedef structure for return
    bidAdapterWebsites: ModuleDistribution;
    idModuleWebsites: ModuleDistribution;
    rtdModuleWebsites: ModuleDistribution;
    analyticsAdapterWebsites: ModuleDistribution;
    otherModuleWebsites: ModuleDistribution;
} {
    const categorized = _categorizeModules(
        moduleWebsiteData,
        MIN_COUNT_THRESHOLD,
        (dataSet: Set<string>) => dataSet.size, // countExtractor for website sets
        defaultModuleCategories
    );

    // Map from general category names to specific 'Websites' suffixed names
    return {
        bidAdapterWebsites: categorized.bidAdapter,
        idModuleWebsites: categorized.idModule,
        rtdModuleWebsites: categorized.rtdModule,
        analyticsAdapterWebsites: categorized.analyticsAdapter,
        otherModuleWebsites: categorized.other,
    };
}

/**
 * Defines the structure for the return type of {@link processModuleDistribution}.
 * @typedef {object} ProcessedModuleDistribution
 * @property {ModuleDistribution} bidAdapterInst - Distribution of bid adapter instances.
 * @property {ModuleDistribution} idModuleInst - Distribution of ID module instances.
 * @property {ModuleDistribution} rtdModuleInst - Distribution of RTD module instances.
 * @property {ModuleDistribution} analyticsAdapterInst - Distribution of analytics adapter instances.
 * @property {ModuleDistribution} otherModuleInst - Distribution of other module instances.
 */

/**
 * Sorts, filters, and categorizes raw Prebid.js module instance counts.
 * Modules are counted per instance, so if a module is part of many Prebid instances, it gets a high count.
 * This version uses the generic `_categorizeModules` helper after sorting.
 *
 * @param {ModuleDistribution} rawModuleCounts - An object where keys are module names and values are their raw instance counts.
 * @param {number} MIN_COUNT_THRESHOLD - The minimum instance count for a module to be included in the final distributions.
 * @returns {ProcessedModuleDistribution} An object containing categorized module distributions based on instance counts.
 * @remarks This function helps identify frequently used modules within Prebid.js setups.
 * The sorting is done by instance count in descending order before categorization.
 */
function processModuleDistribution(
    rawModuleCounts: ModuleDistribution,
    MIN_COUNT_THRESHOLD: number
): { // Matches the ProcessedModuleDistribution typedef structure for return
    bidAdapterInst: ModuleDistribution;
    idModuleInst: ModuleDistribution;
    rtdModuleInst: ModuleDistribution;
    analyticsAdapterInst: ModuleDistribution;
    otherModuleInst: ModuleDistribution;
} {
    // Sort modules by count in descending order first
    const sortedRawModules: string[] = Object.keys(rawModuleCounts).sort((a, b) => rawModuleCounts[b] - rawModuleCounts[a]);
    const sortedRawModuleCounts: ModuleDistribution = {};
    for (const moduleName of sortedRawModules) {
        sortedRawModuleCounts[moduleName] = rawModuleCounts[moduleName];
    }

    const categorized = _categorizeModules(
        sortedRawModuleCounts, // Use the sorted counts
        MIN_COUNT_THRESHOLD,
        (count: number) => count, // countExtractor for direct counts
        defaultModuleCategories
    );

    // Map from general category names to specific 'Inst' suffixed names
    return {
        bidAdapterInst: categorized.bidAdapter,
        idModuleInst: categorized.idModule,
        rtdModuleInst: categorized.rtdModule,
        analyticsAdapterInst: categorized.analyticsAdapter,
        otherModuleInst: categorized.other,
    };
}

/**
 * Defines the structure for the return type of {@link processVersionDistribution}.
 * @typedef {object} ProcessedVersionDistribution
 * @property {VersionDistribution} releaseVersions - Distribution of official release versions.
 * @property {VersionDistribution} buildVersions - Distribution of build versions (e.g., ending with "-pre").
 * @property {VersionDistribution} customVersions - Distribution of custom or non-standard versions.
 */

/**
 * Sorts and categorizes raw Prebid.js version counts into release, build, and custom versions.
 *
 * @param {VersionDistribution} rawVersionCounts - An object where keys are version strings and values are their raw counts.
 * @returns {ProcessedVersionDistribution} An object containing categorized version distributions.
 * @remarks
 * Versions are cleaned by removing a leading 'v' if present (e.g., "v8.42.0" becomes "8.42.0").
 * Sorting of versions is handled by {@link compareVersions}.
 * - Release versions are standard semantic versions (e.g., "X.Y.Z").
 * - Build versions are identified by a "-pre" suffix.
 * - Custom versions include any other versions with hyphens or non-standard formats.
 */
function processVersionDistribution(rawVersionCounts: VersionDistribution): {
    releaseVersions: VersionDistribution;
    buildVersions: VersionDistribution;
    customVersions: VersionDistribution;
} {
    const releaseVersions: VersionDistribution = {};
    const buildVersions: VersionDistribution = {};
    const customVersions: VersionDistribution = {};

    // Sort versions using the custom compareVersions function
    const sortedRawVersions: string[] = Object.keys(rawVersionCounts).sort(compareVersions);

    // Create a new object with sorted counts (optional, direct iteration over sortedRawVersions is also fine)
    const sortedRawVersionCounts: VersionDistribution = {};
    for (const version of sortedRawVersions) {
        sortedRawVersionCounts[version] = rawVersionCounts[version];
    }

    for (const version in sortedRawVersionCounts) {
        const count: number = sortedRawVersionCounts[version];
        // Remove 'v' prefix for consistency (e.g., v8.1.0 -> 8.1.0)
        const cleanedVersion: string = version.startsWith('v') ? version.substring(1) : version;

        if (version.endsWith('-pre')) {
            buildVersions[cleanedVersion] = count;
        } else if (version.includes('-')) { // Catches other versions with hyphens (e.g., custom builds)
            customVersions[cleanedVersion] = count;
        } else { // Assumed to be release versions or non-standard that don't fit build/custom with hyphen
            if (cleanedVersion.includes('.')) { // Standard x.y.z format
                releaseVersions[cleanedVersion] = count;
            } else { // Non-standard format without hyphen (e.g., "12345"), also treated as custom
                customVersions[cleanedVersion] = count;
            }
        }
    }

    return {
        releaseVersions,
        buildVersions,
        customVersions,
    };
}

/**
 * Compares two Prebid.js version strings for sorting purposes.
 * It sorts in descending order (newest versions first).
 * This function handles standard semantic versioning (Major.Minor.Patch) and common pre-release identifiers.
 *
 * @param {string} a - The first version string.
 * @param {string} b - The second version string.
 * @returns {number}
 *  - A negative number if version `b` is newer than `a`.
 *  - A positive number if version `a` is newer than `b`.
 *  - `0` if versions are identical.
 * @remarks
 * The sorting order is: Major (desc) -> Minor (desc) -> Patch (desc) -> Pre-release (asc, where null/release is newest).
 * For pre-releases, standard versions (null preRelease) are considered newer than pre-release versions.
 * If both are pre-releases, they are compared lexicographically (e.g., "alpha" < "beta").
 * @example
 * compareVersions("8.2.0", "8.1.0");   // Returns > 0 (8.2.0 is newer)
 * compareVersions("7.53.0", "8.0.0");  // Returns < 0 (8.0.0 is newer)
 * compareVersions("8.0.0", "8.0.0");   // Returns 0
 * compareVersions("8.0.0-pre", "8.0.0"); // Returns > 0 (8.0.0 is newer)
 * compareVersions("8.0.0-beta", "8.0.0-alpha"); // Returns < 0 (beta is newer than alpha by string compare)
 */
function compareVersions(a: string, b: string): number {
    const vA: VersionComponents = parseVersion(a);
    const vB: VersionComponents = parseVersion(b);

    if (vA.major !== vB.major) return vB.major - vA.major;
    if (vA.minor !== vB.minor) return vB.minor - vA.minor;
    if (vA.patch !== vB.patch) return vB.patch - vA.patch;

    // Handle pre-release versions: null preRelease (release version) is considered newer.
    if (vA.preRelease === null && vB.preRelease !== null) return -1; // b is pre-release, a is release; a is newer
    if (vA.preRelease !== null && vB.preRelease === null) return 1;  // a is pre-release, b is release; b is newer

    // If both are pre-releases or both are releases (null preRelease), compare preRelease strings.
    // Standard string comparison: 'alpha' < 'beta'.
    // This might need adjustment for complex pre-release sorting (e.g. beta.1 vs beta.2) if required.
    if (vA.preRelease && vB.preRelease) {
        if (vA.preRelease < vB.preRelease) return -1;
        if (vA.preRelease > vB.preRelease) return 1;
    }
    return 0; // Versions are identical
}

/**
 * Processes an array of SiteData objects (typically from a single parsed JSON file)
 * to update various statistics accumulators.
 *
 * @param {SiteData[]} siteEntries - An array of site data entries to process.
 * @param {string} currentFileUrlForLogging - The URL or path of the file these entries came from (used for logging/context, not direct logic).
 * @param {Set<string>} uniqueUrls - A Set to accumulate all unique site URLs encountered. Modified by this function.
 * @param {Set<string>} urlsWithPrebid - A Set to accumulate unique site URLs where Prebid.js is detected. Modified by this function.
 * @param {VersionDistribution} rawVersionCounts - A map to accumulate counts of Prebid.js versions. Modified by this function.
 * @param {ModuleDistribution} rawModuleCounts - A map to accumulate counts of Prebid.js module instances. Modified by this function.
 * @param {{ [moduleName: string]: Set<string> }} moduleWebsiteData - A map where keys are module names and values are Sets of
 * unique website URLs using that module. Modified by this function.
 * @remarks This function directly modifies the passed-in Set and Map objects.
 */
function _processSiteEntries(
    siteEntries: SiteData[],
    currentFileUrlForLogging: string, // Although passed, not directly used in current logic but good for context
    uniqueUrls: Set<string>,
    urlsWithPrebid: Set<string>,
    rawVersionCounts: VersionDistribution,
    rawModuleCounts: ModuleDistribution,
    moduleWebsiteData: { [moduleName: string]: Set<string> }
): void {
    if (!Array.isArray(siteEntries)) {
        // console.warn(`_processSiteEntries received non-array data for ${currentFileUrlForLogging}`); // Optional warning
        return;
    }

    siteEntries.forEach((siteData: SiteData) => {
        const currentUrl: string | undefined = siteData?.url?.trim();
        let hasPrebidInstanceOnSite: boolean = false;

        if (currentUrl) {
            uniqueUrls.add(currentUrl);
        }

        if (Array.isArray(siteData.prebidInstances)) {
            siteData.prebidInstances.forEach((instance: PrebidInstanceData) => {
                if (instance) { // Basic check for valid instance data
                    hasPrebidInstanceOnSite = true;

                    // Aggregate version counts
                    if (typeof instance.version === 'string') {
                        const version: string = instance.version.trim();
                        if (version) { // Ensure version string is not empty
                            rawVersionCounts[version] = (rawVersionCounts[version] || 0) + 1;
                        }
                    }

                    // Aggregate module instance counts and websites per module
                    if (Array.isArray(instance.modules)) {
                        instance.modules.forEach((moduleName: string) => {
                            if (typeof moduleName === 'string') {
                                const trimmedModule: string = moduleName.trim();
                                if (trimmedModule) { // Ensure module name is not empty
                                    rawModuleCounts[trimmedModule] = (rawModuleCounts[trimmedModule] || 0) + 1;
                                    if (currentUrl) { // Ensure URL is present for website tracking
                                        if (!moduleWebsiteData[trimmedModule]) {
                                            moduleWebsiteData[trimmedModule] = new Set();
                                        }
                                        moduleWebsiteData[trimmedModule].add(currentUrl);
                                    }
                                }
                            }
                        });
                    }
                }
            });
        }
        if (currentUrl && hasPrebidInstanceOnSite) {
            urlsWithPrebid.add(currentUrl);
        }
    });
}


/**
 * Defines the structure of data aggregated by {@link readAndParseFiles} from raw scan files.
 * @typedef {object} ParsedData
 * @property {Set<string>} uniqueUrls - A set of all unique website URLs encountered during parsing.
 * @property {Set<string>} urlsWithPrebid - A set of unique website URLs where at least one Prebid.js instance was detected.
 * @property {VersionDistribution} rawVersionCounts - Raw, unsorted counts of each Prebid.js version string found.
 * @property {ModuleDistribution} rawModuleCounts - Raw, unsorted counts of each Prebid.js module instance found.
 * @property {{ [moduleName: string]: Set<string> }} moduleWebsiteData - An object where keys are module names
 * and values are Sets of unique website URLs where the respective module was detected.
 */

/**
 * Reads and parses all JSON scan data files from monthly subdirectories within the specified output directory.
 * It aggregates data about unique URLs, Prebid.js versions, modules, and websites per module.
 *
 * @param {string} outputDir - The base directory (e.g., './store') containing subdirectories for each month (e.g., 'Jan', 'Feb').
 * @param {RegExp} monthAbbrRegex - A regular expression used to identify month-named subdirectories (e.g., /^[A-Z][a-z]{2}$/).
 * @returns {Promise<ParsedData>} A promise that resolves to an object containing the aggregated raw data.
 * @throws Will log errors using the logger instance if file reading or JSON parsing fails for individual files, but will attempt to process all valid files.
 * The promise itself should generally resolve unless a critical error occurs in directory reading.
 */
async function readAndParseFiles(outputDir: string, monthAbbrRegex: RegExp): Promise<{
    uniqueUrls: Set<string>;
    urlsWithPrebid: Set<string>;
    rawVersionCounts: VersionDistribution;
    rawModuleCounts: ModuleDistribution;
    moduleWebsiteData: { [moduleName: string]: Set<string> };
}> {
    const rawVersionCounts: VersionDistribution = {};
    const rawModuleCounts: ModuleDistribution = {};
    const moduleWebsiteData: { [moduleName: string]: Set<string> } = {}; // Stores unique URLs per module
    const uniqueUrls: Set<string> = new Set(); // All unique URLs encountered
    const urlsWithPrebid: Set<string> = new Set(); // Unique URLs with at least one Prebid instance

    const outputEntries: import('fs').Dirent[] = await fsPromises.readdir(outputDir, { withFileTypes: true });

    for (const entry of outputEntries) {
        if (entry.isDirectory() && monthAbbrRegex.test(entry.name)) { // Process only valid month directories
            const monthDirPath: string = path.join(outputDir, entry.name);
            const files: string[] = await fsPromises.readdir(monthDirPath);

            for (const file of files) {
                if (path.extname(file).toLowerCase() === '.json') { // Process only JSON files
                    const filePath: string = path.join(monthDirPath, file);
                    try {
                        const fileContent: string = await fsPromises.readFile(filePath, 'utf8');
                        const siteEntries: SiteData[] = JSON.parse(fileContent); // Expect an array of SiteData

                        // Delegate processing of the parsed site entries
                        _processSiteEntries(
                            siteEntries,
                            filePath,
                            uniqueUrls,
                            urlsWithPrebid,
                            rawVersionCounts,
                            rawModuleCounts,
                            moduleWebsiteData
                        );

                    } catch (parseError: any) {
                        const errorMessage = `Error parsing JSON file ${filePath}:`;
                        logger.instance.error(errorMessage, { errorName: parseError.name, errorMessage: parseError.message, stack: parseError.stack });
                        // Continue processing other files even if one fails
                    }
                }
            }
        }
    }

    return {
        uniqueUrls,
        urlsWithPrebid,
        rawVersionCounts,
        rawModuleCounts,
        moduleWebsiteData,
    };
}

/**
 * Main orchestration function to generate Prebid.js usage statistics.
 * It performs the following steps:
 * 1. Reads and parses raw scan data from JSON files located in monthly subdirectories (via {@link readAndParseFiles}).
 * 2. Processes the aggregated raw version data to categorize versions into release, build, and custom types (via {@link processVersionDistribution}).
 * 3. Processes the aggregated raw module instance counts to categorize modules and filter by threshold (via {@link processModuleDistribution}).
 * 4. Processes the data on unique websites per module to categorize modules and filter by threshold (via {@link processModuleWebsiteCounts}).
 * 5. Compiles all processed data into the {@link FinalApiData} structure.
 * 6. Writes the `FinalApiData` to the `api/api.json` file.
 *
 * @async
 * @function updateAndCleanStats
 * @returns {Promise<void>} A promise that resolves when the process is complete and the API file is written, or rejects if a critical error occurs.
 * @remarks
 * This function relies on several helper functions to perform specific parts of the data processing pipeline.
 * The `MIN_COUNT_THRESHOLD` constant is used to filter out low-frequency modules/versions.
 * Errors during file operations or data processing are logged using a logger instance.
 * The output is a JSON file intended for consumption by an API or for direct analysis.
 * @see {@link finalApiFilePath} for the output file location.
 * @see {@link MIN_COUNT_THRESHOLD} for the filtering threshold.
 */
async function updateAndCleanStats(): Promise<void> {
    const monthAbbrRegex: RegExp = /^[A-Z][a-z]{2}$/; // Regex to identify month-named directories like "Jan", "Feb"

    try {
        const {
            uniqueUrls,
            urlsWithPrebid,
            rawVersionCounts,
            rawModuleCounts,
            moduleWebsiteData,
        } = await readAndParseFiles(outputDir, monthAbbrRegex);

        const {
            releaseVersions,
            buildVersions,
            customVersions
        } = processVersionDistribution(rawVersionCounts);

        const {
            bidAdapterInst,
            idModuleInst,
            rtdModuleInst,
            analyticsAdapterInst,
            otherModuleInst
        } = processModuleDistribution(rawModuleCounts, MIN_COUNT_THRESHOLD);

        const {
            bidAdapterWebsites,
            idModuleWebsites,
            rtdModuleWebsites,
            analyticsAdapterWebsites,
            otherModuleWebsites
        } = processModuleWebsiteCounts(moduleWebsiteData, MIN_COUNT_THRESHOLD);

        const finalApiData: FinalApiData = {
            visitedSites: uniqueUrls.size, // Populated from readAndParseFiles
            monitoredSites: uniqueUrls.size, // Populated from readAndParseFiles
            prebidSites: urlsWithPrebid.size, // Populated from readAndParseFiles
            releaseVersions, // Populated from processVersionDistribution
            buildVersions, // Populated from processVersionDistribution
            customVersions, // Populated from processVersionDistribution
            bidAdapterInst, // Populated from processModuleDistribution
            idModuleInst, // Populated from processModuleDistribution
            rtdModuleInst, // Populated from processModuleDistribution
            analyticsAdapterInst, // Populated from processModuleDistribution
            otherModuleInst, // Populated from processModuleDistribution
            bidAdapterWebsites, // Populated from processModuleWebsiteCounts
            idModuleWebsites, // Populated from processModuleWebsiteCounts
            rtdModuleWebsites, // Populated from processModuleWebsiteCounts
            analyticsAdapterWebsites, // Populated from processModuleWebsiteCounts
            otherModuleWebsites // Populated from processModuleWebsiteCounts
        };

        const targetApiDir = path.dirname(finalApiFilePath);
        try {
            await fsPromises.access(targetApiDir);
        } catch (error) { // Explicitly type error for clarity, though 'any' is fine here
            await fsPromises.mkdir(targetApiDir, { recursive: true });
        }

        await fsPromises.writeFile(finalApiFilePath, JSON.stringify(finalApiData, null, 2));
        console.log(`Successfully created ${finalApiFilePath}`);

    } catch (err: any) { // Catch errors from readAndParseFiles or subsequent processing
        const errorMessage = 'Error in updateAndCleanStats:';
        logger.instance.error(errorMessage, { errorName: err.name, errorMessage: err.message, stack: err.stack });
    }
}

export { updateAndCleanStats, readAndParseFiles }; // Export the new function
