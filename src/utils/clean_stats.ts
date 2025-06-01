import { promises as fs } from 'fs';
import * as path from 'path'; // Changed to namespace import
import { fileURLToPath } from 'url';

// Replicate __dirname functionality for ES modules
const __filename: string = fileURLToPath(import.meta.url);
const __dirname: string = path.dirname(__filename);

interface VersionDistribution {
    [version: string]: number;
}

interface ModuleDistribution {
    [moduleName: string]: number;
}

interface SummarizationData {
    visitedSites: number;
    monitoredSites: number;
    prebidSites: number;
    versionDistribution: VersionDistribution;
    moduleDistribution: ModuleDistribution;
}

interface OutputData {
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

async function cleanStats(): Promise<void> {
  const inputPath: string = path.join(__dirname, '..', '..', 'api', 'summarization.json');
  const outputPath: string = path.join(__dirname, '..', '..', 'api', 'api.json');
  const MIN_COUNT_THRESHOLD: number = 5;

  try {
    // Read the summarization.json file
    const rawData: string = await fs.readFile(inputPath, 'utf8');
    const data: SummarizationData = JSON.parse(rawData);

    const outputData: OutputData = {
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

    const versionDistribution: VersionDistribution = data.versionDistribution;
    const versions: string[] = Object.keys(versionDistribution);

    // Process versionDistribution
    for (const version of versions) {
      const count: number = versionDistribution[version];
      const cleanedVersion: string = version.startsWith('v') ? version.substring(1) : version; // Remove leading 'v'

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
    const moduleDistribution: ModuleDistribution = data.moduleDistribution;
    for (const moduleName in moduleDistribution) {
        const count: number = moduleDistribution[moduleName];

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

    // Ensure the target directory exists before writing
    const targetApiDir = path.dirname(outputPath);
    try {
      await fs.access(targetApiDir);
    } catch (error) { // If access fails (e.g., directory doesn't exist), try to create it
      await fs.mkdir(targetApiDir, { recursive: true });
    }

    // Write the new structure to api.json
    await fs.writeFile(outputPath, JSON.stringify(outputData, null, 2));
    console.log(`Successfully created ${outputPath}`);

  } catch (error: any) {
    console.error('Error processing stats:', error);
  }
}

// Run the function
cleanStats();
