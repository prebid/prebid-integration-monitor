import { promises as fsPromises } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputDir = path.join(__dirname, '..', 'store');
const finalApiFilePath = path.join(__dirname, '..', '..', 'api', 'api.json');
const MIN_COUNT_THRESHOLD = 5;
function parseVersion(versionString) {
    if (!versionString) {
        console.warn(`Attempted to parse null or undefined version string.`);
        return { major: 0, minor: 0, patch: 0, preRelease: 'invalid' };
    }
    const match = versionString.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
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
function compareVersions(a, b) {
    const vA = parseVersion(a);
    const vB = parseVersion(b);
    if (vA.major !== vB.major)
        return vB.major - vA.major;
    if (vA.minor !== vB.minor)
        return vB.minor - vA.minor;
    if (vA.patch !== vB.patch)
        return vB.patch - vA.patch;
    if (vA.preRelease === null && vB.preRelease !== null)
        return -1;
    if (vA.preRelease !== null && vB.preRelease === null)
        return 1;
    if (vA.preRelease && vB.preRelease) {
        if (vA.preRelease < vB.preRelease)
            return -1;
        if (vA.preRelease > vB.preRelease)
            return 1;
    }
    return 0;
}
/**
 * Main function to summarize and then clean statistics.
 */
async function updateAndCleanStats(options) {
    const rawVersionCounts = {};
    const rawModuleCounts = {};
    const uniqueUrls = new Set();
    const urlsWithPrebid = new Set();
    const monthAbbrRegex = /^[A-Z][a-z]{2}$/;
    try {
        const outputEntries = await fsPromises.readdir(outputDir, { withFileTypes: true });
        for (const entry of outputEntries) {
            if (entry.isDirectory() && monthAbbrRegex.test(entry.name)) {
                const monthDirPath = path.join(outputDir, entry.name);
                const files = await fsPromises.readdir(monthDirPath);
                for (const file of files) {
                    // console.log(`TEMPORARY DEBUG: Processing file: ${path.join(monthDirPath, file)}`); // Restore
                    if (path.extname(file).toLowerCase() === '.json') {
                        const filePath = path.join(monthDirPath, file);
                        try {
                            const fileContent = await fsPromises.readFile(filePath, 'utf8');
                            const siteEntries = JSON.parse(fileContent);
                            if (Array.isArray(siteEntries)) {
                                siteEntries.forEach((siteData) => {
                                    const currentUrl = siteData?.url?.trim();
                                    let hasPrebidInstance = false;
                                    if (currentUrl) {
                                        uniqueUrls.add(currentUrl);
                                    }
                                    if (Array.isArray(siteData.prebidInstances)) {
                                        siteData.prebidInstances.forEach((instance) => {
                                            if (instance) {
                                                hasPrebidInstance = true;
                                                if (typeof instance.version === 'string') {
                                                    const version = instance.version.trim();
                                                    if (version) {
                                                        rawVersionCounts[version] = (rawVersionCounts[version] || 0) + 1;
                                                    }
                                                }
                                                if (Array.isArray(instance.modules)) {
                                                    instance.modules.forEach((moduleName) => {
                                                        if (typeof moduleName === 'string') {
                                                            const trimmedModule = moduleName.trim();
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
                        }
                        catch (parseError) {
                            const errorMessage = `Error parsing JSON file ${filePath}:`;
                            if (options?.logError) {
                                options.logError(errorMessage, parseError.name, parseError.message);
                            }
                            else {
                                console.error(errorMessage, parseError);
                            }
                        }
                    }
                }
            }
        }
        const sortedRawVersions = Object.keys(rawVersionCounts).sort(compareVersions);
        const sortedRawVersionCounts = {};
        for (const version of sortedRawVersions) {
            sortedRawVersionCounts[version] = rawVersionCounts[version];
        }
        const sortedRawModules = Object.keys(rawModuleCounts).sort((a, b) => rawModuleCounts[b] - rawModuleCounts[a]);
        const sortedRawModuleCounts = {};
        for (const moduleName of sortedRawModules) {
            sortedRawModuleCounts[moduleName] = rawModuleCounts[moduleName];
        }
        const summarizationData = {
            visitedSites: uniqueUrls.size,
            monitoredSites: uniqueUrls.size,
            prebidSites: urlsWithPrebid.size,
            versionDistribution: sortedRawVersionCounts,
            moduleDistribution: sortedRawModuleCounts,
        };
        const finalApiData = {
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
        const versionDistributionForCleaning = summarizationData.versionDistribution;
        for (const version in versionDistributionForCleaning) {
            const count = versionDistributionForCleaning[version];
            const cleanedVersion = version.startsWith('v') ? version.substring(1) : version;
            if (version.endsWith('-pre')) {
                finalApiData.buildVersions[cleanedVersion] = count;
            }
            else if (version.includes('-')) {
                finalApiData.customVersions[cleanedVersion] = count;
            }
            else {
                if (cleanedVersion.includes('.')) {
                    finalApiData.releaseVersions[cleanedVersion] = count;
                }
                else {
                    finalApiData.customVersions[cleanedVersion] = count;
                }
            }
        }
        // Process moduleDistribution from summarizationData
        const moduleDistributionForCleaning = summarizationData.moduleDistribution;
        for (const moduleName in moduleDistributionForCleaning) {
            const count = moduleDistributionForCleaning[moduleName];
            if (count < MIN_COUNT_THRESHOLD) {
                continue;
            }
            if (moduleName.includes('BidAdapter')) {
                finalApiData.bidAdapterInst[moduleName] = count;
            }
            else if (moduleName.includes('IdSystem') || moduleName === 'userId' || moduleName === 'idImportLibrary' || moduleName === 'pubCommonId' || moduleName === 'utiqSystem' || moduleName === 'trustpidSystem') {
                finalApiData.idModuleInst[moduleName] = count;
            }
            else if (moduleName.includes('RtdProvider') || moduleName === 'rtdModule') {
                finalApiData.rtdModuleInst[moduleName] = count;
            }
            else if (moduleName.includes('AnalyticsAdapter')) {
                finalApiData.analyticsAdapterInst[moduleName] = count;
            }
            else {
                finalApiData.otherModuleInst[moduleName] = count;
            }
        }
        const targetApiDir = path.dirname(finalApiFilePath);
        try {
            await fsPromises.access(targetApiDir);
        }
        catch (error) {
            await fsPromises.mkdir(targetApiDir, { recursive: true });
        }
        await fsPromises.writeFile(finalApiFilePath, JSON.stringify(finalApiData, null, 2));
        console.log(`Successfully created ${finalApiFilePath}`);
    }
    catch (err) {
        const errorMessage = 'Error processing stats:';
        if (options?.logError) {
            options.logError(errorMessage, err.name, err.message);
        }
        else {
            console.error(errorMessage, err);
        }
    }
}
export { updateAndCleanStats };
