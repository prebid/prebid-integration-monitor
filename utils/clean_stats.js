import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Replicate __dirname functionality for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function cleanStats() {
  const inputPath = path.join(__dirname, '..', 'output', 'summarization.json');
  const outputPath = path.join(__dirname, '..', 'output', 'api.json');
  const MIN_COUNT_THRESHOLD = 5;

  try {
    // Read the summarization.json file
    const rawData = await fs.readFile(inputPath, 'utf8');
    const data = JSON.parse(rawData);

    const outputData = {
      visitedSites: data.visitedSites,
      monitoredSites: data.monitoredSites,
      prebidSites: data.prebidSites,
      releaseVersions: {},
      buildVersions: {},
      customVersions: {},
      bidAdapterInst: {},
      idModuleInst: {},
      rtdModuleInst: {},
      analyticsAdapterInst: {},
      otherModuleInst: {}
    };

    const versionDistribution = data.versionDistribution;
    const versions = Object.keys(versionDistribution);

    // Process versionDistribution
    for (const version of versions) {
      const count = versionDistribution[version];
      const cleanedVersion = version.startsWith('v') ? version.substring(1) : version; // Remove leading 'v'

      if (version.endsWith('-pre')) {
        outputData.buildVersions[cleanedVersion] = count;
      } else if (version.includes('-')) {
        outputData.customVersions[cleanedVersion] = count;
      } else {
        // Check if it's a standard semantic version or potentially missing patch/minor
        // Simple check: contains '.' and no dash (after potential 'v' removal).
        if (cleanedVersion.includes('.')) {
             outputData.releaseVersions[cleanedVersion] = count;
        } else {
             // Treat other cases (like '9.35') potentially as custom or decide on a rule
             // For now, placing in custom as it deviates from standard semver X.Y.Z
             outputData.customVersions[cleanedVersion] = count;
        }
      }
    }

    // Process moduleDistribution
    const moduleDistribution = data.moduleDistribution;
    for (const moduleName in moduleDistribution) {
        const count = moduleDistribution[moduleName];

        // Ignore modules with count less than the threshold
        if (count < MIN_COUNT_THRESHOLD) {
            continue;
        }

        if (moduleName.includes('BidAdapter')) {
            outputData.bidAdapterInst[moduleName] = count;
        } else if (moduleName.includes('IdSystem') || moduleName === 'userId' || moduleName === 'idImportLibrary' || moduleName === 'pubCommonId' || moduleName === 'utiqSystem' || moduleName === 'trustpidSystem') {
            outputData.idModuleInst[moduleName] = count;
        } else if (moduleName.includes('RtdProvider') || moduleName === 'rtdModule') {
            outputData.rtdModuleInst[moduleName] = count;
        } else if (moduleName.includes('AnalyticsAdapter')) {
            outputData.analyticsAdapterInst[moduleName] = count;
        } else {
            outputData.otherModuleInst[moduleName] = count;
        }
    }


    // Write the new structure to api.json
    await fs.writeFile(outputPath, JSON.stringify(outputData, null, 2));
    console.log(`Successfully created ${outputPath}`);

  } catch (error) {
    console.error('Error processing stats:', error);
  }
}

// Run the function
cleanStats();
