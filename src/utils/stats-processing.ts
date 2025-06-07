import logger from './logger.js';

// ##################################################################################################
// TYPE DEFINITIONS - Grouping types that are closely related to the processing functions
// ##################################################################################################

/**
 * Represents data collected from a single website during a scan.
 * @interface SiteData
 * @property {string} [url] - The URL of the website. Optional, but expected in practice.
 * @property {PrebidInstanceData[]} [prebidInstances] - An array of Prebid.js instances found on the site. Optional if no instances detected.
 */
export interface SiteData {
  url?: string;
  prebidInstances?: PrebidInstanceData[];
}

/**
 * Represents data for a single Prebid.js instance found on a website.
 * @interface PrebidInstanceData
 * @property {string} [version] - The version of the Prebid.js instance (e.g., "8.42.0", "v7.53.0-pre"). Optional if version couldn't be determined.
 * @property {string[]} [modules] - An array of module names (e.g., "rubiconBidAdapter", "userId") associated with the Prebid.js instance. Optional if no modules detected or applicable.
 */
export interface PrebidInstanceData {
  version?: string;
  modules?: string[];
}

/**
 * Represents the distribution of Prebid.js versions.
 * Keys are version strings (e.g., "8.42.0") and values are their counts.
 * @typedef {Object<string, number>} VersionDistribution
 * @property {number} [version] - Count for a specific version string.
 */
export interface VersionDistribution {
  [version: string]: number;
}

/**
 * Represents the distribution of Prebid.js modules.
 * Keys are module names (e.g., "rubiconBidAdapter") and values are their counts.
 * @typedef {Object<string, number>} ModuleDistribution
 * @property {number} [moduleName] - Count for a specific module name.
 */
export interface ModuleDistribution {
  [moduleName: string]: number;
}

/**
 * Represents the individual components of a parsed semantic version string.
 * @interface VersionComponents
 * @property {number} major - The major version number.
 * @property {number} minor - The minor version number.
 * @property {number} patch - The patch version number.
 * @property {string|null} preRelease - The pre-release identifier (e.g., 'alpha', 'beta', 'pre.1'), or null if it's a release version.
 * @see {@link https://semver.org/ Semantic Versioning}
 */
export interface VersionComponents {
  major: number;
  minor: number;
  patch: number;
  preRelease: string | null;
}

/**
 * Represents the structure for categorized module distributions.
 * Each property holds a `ModuleDistribution` map for a specific category.
 *
 * @typedef {object} CategorizedModules
 * @property {ModuleDistribution} bidAdapter - Distribution of bid adapter modules.
 * @property {ModuleDistribution} idModule - Distribution of ID system modules.
 * @property {ModuleDistribution} rtdModule - Distribution of RTD modules.
 * @property {ModuleDistribution} analyticsAdapter - Distribution of analytics adapter modules.
 * @property {ModuleDistribution} other - Distribution of modules not fitting into other predefined categories.
 */
export interface CategorizedModules {
  bidAdapter: ModuleDistribution;
  idModule: ModuleDistribution;
  rtdModule: ModuleDistribution;
  analyticsAdapter: ModuleDistribution;
  other: ModuleDistribution;
}

/**
 * Defines the structure for the return type of {@link processModuleWebsiteCounts}.
 * This structure holds module distributions categorized by type, where counts
 * represent the number of unique websites using each module.
 *
 * @typedef {object} ProcessedModuleWebsiteCounts
 * @property {ModuleDistribution} bidAdapterWebsites - Distribution of unique websites using specific bid adapter modules.
 * @property {ModuleDistribution} idModuleWebsites - Distribution of unique websites using specific ID system modules.
 * @property {ModuleDistribution} rtdModuleWebsites - Distribution of unique websites using specific RTD modules.
 * @property {ModuleDistribution} analyticsAdapterWebsites - Distribution of unique websites using specific analytics adapter modules.
 * @property {ModuleDistribution} otherModuleWebsites - Distribution of unique websites using other specific modules not fitting predefined categories.
 */
export interface ProcessedModuleWebsiteCounts {
  bidAdapterWebsites: ModuleDistribution;
  idModuleWebsites: ModuleDistribution;
  rtdModuleWebsites: ModuleDistribution;
  analyticsAdapterWebsites: ModuleDistribution;
  otherModuleWebsites: ModuleDistribution;
}

/**
 * Defines the structure for the return type of {@link processModuleDistribution}.
 * This structure holds module distributions categorized by type, where counts
 * represent the number of Prebid.js instances that include each module.
 *
 * @typedef {object} ProcessedModuleDistribution
 * @property {ModuleDistribution} bidAdapterInst - Distribution of Prebid.js bid adapter module instances.
 * @property {ModuleDistribution} idModuleInst - Distribution of Prebid.js ID system module instances.
 * @property {ModuleDistribution} rtdModuleInst - Distribution of Prebid.js Real-Time Data (RTD) module instances.
 * @property {ModuleDistribution} analyticsAdapterInst - Distribution of Prebid.js analytics adapter module instances.
 * @property {ModuleDistribution} otherModuleInst - Distribution of other Prebid.js module instances not fitting predefined categories.
 */
export interface ProcessedModuleDistribution {
  bidAdapterInst: ModuleDistribution;
  idModuleInst: ModuleDistribution;
  rtdModuleInst: ModuleDistribution;
  analyticsAdapterInst: ModuleDistribution;
  otherModuleInst: ModuleDistribution;
}

/**
 * Defines the structure for the return type of {@link processVersionDistribution}.
 * This structure holds version distributions categorized into release, build, and custom types.
 *
 * @typedef {object} ProcessedVersionDistribution
 * @property {VersionDistribution} releaseVersions - Distribution of official release Prebid.js versions (e.g., "8.42.0").
 * @property {VersionDistribution} buildVersions - Distribution of Prebid.js build versions, typically ending with "-pre" (e.g., "8.42.0-pre").
 * @property {VersionDistribution} customVersions - Distribution of custom or non-standard Prebid.js versions
 *           (e.g., "8.42.0-custom", or versions not matching X.Y.Z or X.Y.Z-pre patterns).
 */
export interface ProcessedVersionDistribution {
  releaseVersions: VersionDistribution;
  buildVersions: VersionDistribution;
  customVersions: VersionDistribution;
}

import { DEFAULT_MODULE_CATEGORIES } from '../config/stats-config.js';

// ##################################################################################################
// CONSTANTS - e.g. defaultModuleCategories
// ##################################################################################################

// defaultModuleCategories is now imported from stats-config.js

// ##################################################################################################
// FUNCTIONS
// ##################################################################################################

/**
 * Parses a Prebid.js version string into its major, minor, patch, and pre-release components.
 * Handles versions with an optional 'v' prefix and pre-release suffixes (e.g., "-pre", "-alpha.1").
 *
 * @function parseVersion
 * @param {string | undefined} versionString - The version string to parse.
 *        Examples: "7.53.0", "v8.1.0-pre", "9.0.0-alpha.1".
 * @returns {VersionComponents} An object containing the parsed version components.
 *          If `versionString` is null, undefined, or cannot be parsed according to the expected format:
 *          - For null/undefined input, returns `{ major: 0, minor: 0, patch: 0, preRelease: 'invalid' }`.
 *          - For unparseable strings (not matching `vX.Y.Z(-prerelease)`),
 *            returns `{ major: 0, minor: 0, patch: 0, preRelease: originalInputString }`.
 */
export function parseVersion(
  versionString: string | undefined,
): VersionComponents {
  if (!versionString) {
    // Optionally log if strict parsing is expected and undefined/null is an issue:
    // logger.instance.debug('parseVersion received null or undefined versionString.');
    return { major: 0, minor: 0, patch: 0, preRelease: 'invalid' };
  }
  const match: RegExpMatchArray | null = versionString.match(
    /^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/,
  );
  if (!match) {
    logger.instance.warn(
      `Could not parse version string: "${versionString}" into X.Y.Z format. Returning as custom preRelease.`,
    );
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
 * Compares two Prebid.js version strings for sorting, aiming for descending order (newest versions first).
 * It uses {@link parseVersion} to break down versions into components (Major.Minor.Patch.Pre-release).
 *
 * @function compareVersions
 * @param {string} a - The first version string.
 * @param {string} b - The second version string.
 * @returns {number} Returns `< 0` if `a` is newer, `> 0` if `b` is newer, `0` if equal. For use with `Array.sort()` for descending order.
 * @example
 * // For Array.prototype.sort((a,b) => compareVersions(a,b)) to sort newest first:
 * // if a is newer than b, return -1
 * // if b is newer than a, return 1
 * // if equal, return 0
 * compareVersions("8.2.0", "8.1.0");       // Returns < 0 (8.2.0 is newer than 8.1.0)
 * compareVersions("7.53.0", "8.0.0");      // Returns > 0 (8.0.0 is newer than 7.53.0)
 * compareVersions("8.0.0", "8.0.0");       // Returns 0
 * compareVersions("8.0.0-pre", "8.0.0");   // Returns > 0 (8.0.0 is newer than 8.0.0-pre)
 * compareVersions("8.0.0-beta", "8.0.0-alpha"); // Returns < 0 (8.0.0-beta is newer than 8.0.0-alpha)
 */
export function compareVersions(a: string, b: string): number {
  const vA: VersionComponents = parseVersion(a);
  const vB: VersionComponents = parseVersion(b);

  // Compare major, minor, patch versions in descending order
  if (vA.major !== vB.major) return vB.major - vA.major; // If vB.major > vA.major, positive (b newer), else negative (a newer)
  if (vA.minor !== vB.minor) return vB.minor - vA.minor;
  if (vA.patch !== vB.patch) return vB.patch - vA.patch;

  // Pre-release handling for descending sort (release > pre-release)
  // A release version (preRelease is null) is considered newer than a pre-release version.
  if (vA.preRelease === null && vB.preRelease !== null) return -1; // a is release, b is pre-release; a is newer
  if (vA.preRelease !== null && vB.preRelease === null) return 1; // a is pre-release, b is release; b is newer

  // If both are pre-releases (or both null), compare preRelease strings lexicographically.
  // For descending sort of versions, a "larger" pre-release string (e.g. "beta" vs "alpha") is considered newer.
  if (vA.preRelease && vB.preRelease) {
    if (vA.preRelease < vB.preRelease) return 1; // a is "smaller" (e.g. alpha), so b (e.g. beta) is newer
    if (vA.preRelease > vB.preRelease) return -1; // a is "larger", so a is newer
  }
  return 0;
}

/**
 * Generic internal helper function to categorize modules from a data source.
 *
 * @private
 * @template T
 * @param dataSource - The source of module data.
 * @param minCountThreshold - Minimum count for a module to be included.
 * @param countExtractor - Function to extract numerical count from a data source item.
 * @param moduleCategoryPredicates - Predicates for categorizing modules.
 * @returns An object containing modules categorized into distributions.
 */
export function _categorizeModules<T>( // Made exportable for potential testing, though still "internal" by convention
  dataSource: { [moduleName: string]: T },
  minCountThreshold: number,
  countExtractor: (item: T) => number,
  moduleCategoryPredicates: Readonly<typeof DEFAULT_MODULE_CATEGORIES>, // Updated, Readonly for safety
): CategorizedModules {
  const result: CategorizedModules = {
    bidAdapter: {},
    idModule: {},
    rtdModule: {},
    analyticsAdapter: {},
    other: {},
  };

  for (const moduleName in dataSource) {
    const count = countExtractor(dataSource[moduleName]);
    if (count < minCountThreshold) continue;

    let categorized = false;
    // Iterate over strongly typed keys of moduleCategoryPredicates
    // Ensuring key is typed as a key of CategorizedModules for result[key] access
    // and also compatible with moduleCategoryPredicates which shares the same key structure.
    const categoryKeys = Object.keys(moduleCategoryPredicates) as Array<keyof CategorizedModules>;
    for (const key of categoryKeys) {
      if (moduleCategoryPredicates[key](moduleName)) {
        result[key][moduleName] = count; // result[key] is ModuleDistribution
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
 * Filters and categorizes modules based on the number of unique websites they appear on.
 *
 * @function processModuleWebsiteCounts
 * @param moduleWebsiteData - Object with module names as keys and Sets of unique website URLs as values.
 * @param minCountThreshold - Minimum number of unique websites a module must appear on.
 * @returns Categorized module distributions based on website counts.
 */
export function processModuleWebsiteCounts(
  moduleWebsiteData: { [moduleName: string]: Set<string> },
  minCountThreshold: number,
): ProcessedModuleWebsiteCounts {
  const categorized = _categorizeModules<Set<string>>(
    moduleWebsiteData,
    minCountThreshold,
    (dataSet: Set<string>) => dataSet.size,
    DEFAULT_MODULE_CATEGORIES,
  );
  return {
    bidAdapterWebsites: categorized.bidAdapter,
    idModuleWebsites: categorized.idModule,
    rtdModuleWebsites: categorized.rtdModule,
    analyticsAdapterWebsites: categorized.analyticsAdapter,
    otherModuleWebsites: categorized.other,
  };
}

/**
 * Sorts, filters, and categorizes raw Prebid.js module instance counts.
 *
 * @function processModuleDistribution
 * @param rawModuleCounts - Object with module names as keys and raw instance counts as values.
 * @param minCountThreshold - Minimum instance count for a module to be included.
 * @returns Categorized module distributions based on instance counts.
 */
export function processModuleDistribution(
  rawModuleCounts: ModuleDistribution,
  minCountThreshold: number,
): ProcessedModuleDistribution {
  const sortedRawModules: string[] = Object.keys(rawModuleCounts).sort(
    (a, b) => rawModuleCounts[b] - rawModuleCounts[a],
  );
  const sortedRawModuleCounts: ModuleDistribution = {};
  for (const moduleName of sortedRawModules) {
    sortedRawModuleCounts[moduleName] = rawModuleCounts[moduleName];
  }

  const categorized = _categorizeModules<number>(
    sortedRawModuleCounts,
    minCountThreshold,
    (count: number) => count,
    DEFAULT_MODULE_CATEGORIES,
  );
  return {
    bidAdapterInst: categorized.bidAdapter,
    idModuleInst: categorized.idModule,
    rtdModuleInst: categorized.rtdModule,
    analyticsAdapterInst: categorized.analyticsAdapter,
    otherModuleInst: categorized.other,
  };
}

/**
 * Sorts and categorizes raw Prebid.js version counts into release, build, and custom versions.
 *
 * @function processVersionDistribution
 * @param rawVersionCounts - Object with version strings as keys and raw counts as values.
 * @returns Categorized version distributions.
 */
export function processVersionDistribution(
  rawVersionCounts: VersionDistribution,
): ProcessedVersionDistribution {
  const releaseVersions: VersionDistribution = {};
  const buildVersions: VersionDistribution = {};
  const customVersions: VersionDistribution = {};
  const sortedRawVersions: string[] =
    Object.keys(rawVersionCounts).sort(compareVersions);

  for (const version of sortedRawVersions) {
    const count: number = rawVersionCounts[version];
    const cleanedVersion: string = version.startsWith('v')
      ? version.substring(1)
      : version;
    const originalVersionForCategorization: string = version;

    if (originalVersionForCategorization.endsWith('-pre')) {
      buildVersions[cleanedVersion] = count;
    } else if (originalVersionForCategorization.includes('-')) {
      customVersions[cleanedVersion] = count;
    } else {
      const parsedForValidation = parseVersion(cleanedVersion);
      if (
        parsedForValidation.preRelease === null &&
        cleanedVersion.match(/^\d+\.\d+\.\d+$/)
      ) {
        releaseVersions[cleanedVersion] = count;
      } else {
        customVersions[cleanedVersion] = count;
      }
    }
  }
  return { releaseVersions, buildVersions, customVersions };
}

/**
 * Internal helper function to process an array of `SiteData` objects.
 * Updates various statistics accumulators passed by reference.
 *
 * @private
 * @function _processSiteEntries
 * @param siteEntries - Array of site data entries.
 * @param currentFileSourceInfo - Information about the source file for logging.
 * @param uniqueUrls - Set to accumulate unique site URLs.
 * @param urlsWithPrebid - Set to accumulate unique site URLs with Prebid.
 * @param rawVersionCounts - Map to accumulate Prebid.js version counts.
 * @param rawModuleCounts - Map to accumulate Prebid.js module instance counts.
 * @param moduleWebsiteData - Map to accumulate unique websites per module.
 */
export function _processSiteEntries( // Made exportable for potential testing
  siteEntries: SiteData[],
  currentFileSourceInfo: string,
  uniqueUrls: Set<string>,
  urlsWithPrebid: Set<string>,
  rawVersionCounts: VersionDistribution,
  rawModuleCounts: ModuleDistribution,
  moduleWebsiteData: { [moduleName: string]: Set<string> },
): void {
  if (!Array.isArray(siteEntries)) {
    logger.instance.warn(
      `_processSiteEntries received non-array data for ${currentFileSourceInfo}`,
    );
    return;
  }

  siteEntries.forEach((siteData: SiteData) => {
    const currentUrl: string | undefined = siteData?.url?.trim();
    let hasPrebidInstanceOnSite: boolean = false;

    if (currentUrl) uniqueUrls.add(currentUrl);

    if (Array.isArray(siteData.prebidInstances)) {
      siteData.prebidInstances.forEach((instance: PrebidInstanceData) => {
        if (!instance) return;
        hasPrebidInstanceOnSite = true;

        if (typeof instance.version === 'string') {
          const version: string = instance.version.trim();
          if (version)
            rawVersionCounts[version] = (rawVersionCounts[version] || 0) + 1;
        }

        if (Array.isArray(instance.modules)) {
          instance.modules.forEach((moduleName: string) => {
            if (typeof moduleName === 'string') {
              const trimmedModule: string = moduleName.trim();
              if (trimmedModule) {
                rawModuleCounts[trimmedModule] =
                  (rawModuleCounts[trimmedModule] || 0) + 1;
                if (currentUrl) {
                  if (!moduleWebsiteData[trimmedModule]) {
                    moduleWebsiteData[trimmedModule] = new Set();
                  }
                  moduleWebsiteData[trimmedModule].add(currentUrl);
                }
              }
            }
          });
        }
      });
    }
    if (currentUrl && hasPrebidInstanceOnSite) {
      urlsWithPrebid.add(currentUrl);
    }
  });
}

// logger is imported as _processSiteEntries uses it.
// _categorizeModules and _processSiteEntries were made exportable for potential testing, consistent with original structure.
// JSDoc for functions have been largely kept from the original file.
