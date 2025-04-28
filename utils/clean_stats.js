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
      if (version.endsWith('-pre')) {
        outputData.buildVersions[version] = count;
      } else if (version.includes('-')) {
        outputData.customVersions[version] = count;
      } else {
        if (version.startsWith('v') && version.includes('.')) {
             outputData.releaseVersions[version] = count;
        } else {
             outputData.customVersions[version] = count;
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
