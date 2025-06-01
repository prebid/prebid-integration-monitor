import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs'; // Separate import for promises
import * as path from 'path';
import { summarizeStats } from '../src/utils/update_stats'; // Adjust path as needed
import { cleanStats } from '../src/utils/clean_stats'; // Adjust path

// Mock the 'fs' module for synchronous operations like existsSync, mkdirSync
vi.mock('fs', async (importOriginal) => {
  const originalFs = await importOriginal();
  return {
    ...originalFs, // Spread original fs module
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    // We will mock promises separately or ensure they are covered by the top-level mock if possible
    // For now, let's assume direct fs.promises will be mocked via its own path or covered by this.
    // To be safe, we can re-mock promises specifically if needed.
  };
});

// Mock 'fs/promises' specifically for promise-based operations
// Vitest typically requires specific path for promises version of modules
vi.mock('fs/promises', async (importOriginal) => {
  const originalFsPromises = await importOriginal();
  return {
    ...originalFsPromises,
    readdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(), // Though summarizeStats uses sync mkdir for api dir
    access: vi.fn(), // Though summarizeStats uses sync existsSync for api dir
  };
});


describe('summarizeStats', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.resetAllMocks();

    // Default mock implementations
    // Mock for reading directories under 'store/'
    vi.mocked(fsPromises.readdir).mockImplementation(async (dirPath) => {
      if (String(dirPath).endsWith('store')) {
        return [
          { name: 'Jan', isDirectory: () => true },
          { name: 'Feb', isDirectory: () => true },
          { name: 'randomfile.txt', isDirectory: () => false },
        ];
      } else if (String(dirPath).endsWith('Jan') || String(dirPath).endsWith('Feb')) {
        return [{ name: '2023-01-15.json', isDirectory: () => false }];
      }
      return []; // Default empty
    });

    // Mock for reading JSON files
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify([
      {
        url: 'http://example.com',
        prebidInstances: [{ version: '1.0.0', modules: ['moduleA'] }]
      }
    ]));

    // Mock for writeFile (capture arguments)
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

    // Mock for existsSync (API directory creation check)
    // Default to directory not existing to test creation path
    vi.mocked(fs.existsSync).mockReturnValue(false);
    // Mock for mkdirSync (API directory creation)
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
  });

  it('should write summarization.json to api/ folder', async () => {
    await summarizeStats();

    // Check if writeFile was called with the correct path
    expect(fsPromises.writeFile).toHaveBeenCalled();
    const writeFileCall = vi.mocked(fsPromises.writeFile).mock.calls[0];
    const filePath = writeFileCall[0]; // First argument is the path

    // Construct expected path carefully, __dirname in test is tests/
    // summarizeStats constructs path as path.join(__dirname, '..', '..', 'api', 'summarization.json')
    // from src/utils/, so from tests/ it's path.join(__dirname, '..', 'api', 'summarization.json')
    // However, the path.join inside summarizeStats is what matters.
    // It will resolve to project_root/api/summarization.json
    // We need to ensure our assertion matches how Node's path.join would resolve it from *within the module*
    // For simplicity, we check if it *ends with* 'api/summarization.json' or a platform-independent equivalent.
    const expectedPathSuffix = path.join('api', 'summarization.json');
    expect(String(filePath)).to.satisfy((s: string) => s.endsWith(expectedPathSuffix));

  });

  it('should create api/ directory if it does not exist', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false); // Ensure it's mocked to not exist

    await summarizeStats();

    // Check if mkdirSync was called for the 'api' directory
    expect(fs.existsSync).toHaveBeenCalled();
    const existsSyncCallPath = vi.mocked(fs.existsSync).mock.calls[0][0];
    expect(String(existsSyncCallPath)).to.satisfy((s: string) => s.endsWith('api'));


    expect(fs.mkdirSync).toHaveBeenCalled();
    const mkdirSyncCallPath = vi.mocked(fs.mkdirSync).mock.calls[0][0];
    // Similar to above, check the path passed to mkdirSync
    expect(String(mkdirSyncCallPath)).to.satisfy((s: string) => s.endsWith('api'));
    expect(vi.mocked(fs.mkdirSync).mock.calls[0][1]).toEqual({ recursive: true }); // Check options
  });

  it('should NOT attempt to create api/ directory if it already exists', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true); // Mock to exist

    await summarizeStats();

    expect(fs.existsSync).toHaveBeenCalled(); // Still checks
    expect(fs.mkdirSync).not.toHaveBeenCalled(); // But does not create
  });

  it('should correctly process data from store/month subdirectories', async () => {
    // More specific mock for readdir if needed for this test, but default should be fine.
    // Example: one site in Jan, one in Feb.
    // Jan file:
    const janData = [{ url: 'http://jan.example.com', prebidInstances: [{ version: '1.0.0', modules: ['janModule'] }] }];
    // Feb file:
    const febData = [{ url: 'http://feb.example.com', prebidInstances: [{ version: '2.0.0', modules: ['febModule'] }] }];

    vi.mocked(fsPromises.readFile)
      .mockImplementationOnce(async () => JSON.stringify(janData)) // For Jan/2023-01-15.json
      .mockImplementationOnce(async () => JSON.stringify(febData)); // For Feb/2023-01-15.json (name is illustrative)

    await summarizeStats();

    expect(fsPromises.readdir).toHaveBeenCalledWith(expect.stringMatching(/store$/), { withFileTypes: true });
    expect(fsPromises.readdir).toHaveBeenCalledWith(expect.stringMatching(/Jan$/), undefined); // or { withFileTypes: true } depending on actual usage for files
    expect(fsPromises.readdir).toHaveBeenCalledWith(expect.stringMatching(/Feb$/), undefined);


    expect(fsPromises.readFile).toHaveBeenCalledTimes(2); // Once for Jan, once for Feb based on mock readdir

    const writeFileCall = vi.mocked(fsPromises.writeFile).mock.calls[0];
    const writtenData = JSON.parse(writeFileCall[1] as string); // Second argument is the data

    expect(writtenData.monitoredSites).toBe(2);
    expect(writtenData.prebidSites).toBe(2);
    expect(writtenData.versionDistribution).toEqual({ 'v1.0.0': 1, 'v2.0.0': 1 }); // Sorted by compareVersions
    expect(writtenData.moduleDistribution).toEqual({ janModule: 1, febModule: 1 });
  });
});

// (Keep existing imports and mocks for fs and fs/promises from the previous step)
// import { describe, it, expect, vi, beforeEach } from 'vitest';
// import { promises as fsPromises } from 'fs';
// import * as path from 'path';
// import { cleanStats } from '../src/utils/clean_stats'; // Adjust path

// Mocks for fs and fs/promises should already be in place from summarizeStats tests.
// Ensure they cover 'access' and 'mkdir' for fsPromises.

describe('cleanStats', () => {
  beforeEach(() => {
    // Reset relevant mocks. fsPromises.writeFile is shared, ensure it's clean.
    // fs.existsSync and fs.mkdirSync were for the other util, ensure fsPromises.access/mkdir are reset if they were touched.
    vi.mocked(fsPromises.readFile).mockReset();
    vi.mocked(fsPromises.writeFile).mockReset();
    vi.mocked(fsPromises.access).mockReset();
    vi.mocked(fsPromises.mkdir).mockReset();

    // Default mock implementations for cleanStats
    const mockSummarizationData = {
      visitedSites: 100,
      monitoredSites: 80,
      prebidSites: 60,
      versionDistribution: { 'v1.0.0': 50, 'v2.0.0-pre': 10 },
      moduleDistribution: { 'moduleA': 50, 'moduleB': 5, 'idSystemC': 30 } // moduleB below threshold
    };
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(mockSummarizationData));
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);
  });

  it('should write api.json to api/ folder', async () => {
    // Mock fsPromises.access to indicate directory exists
    vi.mocked(fsPromises.access).mockResolvedValue(undefined);

    await cleanStats();

    expect(fsPromises.writeFile).toHaveBeenCalled();
    const writeFileCall = vi.mocked(fsPromises.writeFile).mock.calls[0];
    const filePath = writeFileCall[0];
    const expectedPathSuffix = path.join('api', 'api.json');
    expect(String(filePath)).to.satisfy((s: string) => s.endsWith(expectedPathSuffix));
  });

  it('should create api/ directory if it does not exist before writing api.json', async () => {
    // Mock fsPromises.access to throw an error (directory does not exist)
    vi.mocked(fsPromises.access).mockRejectedValue(new Error('ENOENT: no such file or directory'));
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined); // Mock mkdir success

    await cleanStats();

    expect(fsPromises.access).toHaveBeenCalled(); // Checked for dir
    const accessCallPath = vi.mocked(fsPromises.access).mock.calls[0][0];
    expect(String(accessCallPath)).to.satisfy((s: string) => s.endsWith('api'));


    expect(fsPromises.mkdir).toHaveBeenCalled(); // Created dir
    const mkdirCallPath = vi.mocked(fsPromises.mkdir).mock.calls[0][0];
    expect(String(mkdirCallPath)).to.satisfy((s: string) => s.endsWith('api'));
    expect(vi.mocked(fsPromises.mkdir).mock.calls[0][1]).toEqual({ recursive: true });
  });

  it('should NOT attempt to create api/ directory if it already exists', async () => {
    vi.mocked(fsPromises.access).mockResolvedValue(undefined); // Dir exists

    await cleanStats();

    expect(fsPromises.access).toHaveBeenCalled();
    expect(fsPromises.mkdir).not.toHaveBeenCalled();
  });

  it('should correctly transform summarization data to api.json structure', async () => {
    vi.mocked(fsPromises.access).mockResolvedValue(undefined); // Dir exists
     const mockSummarizationData = {
      visitedSites: 100,
      monitoredSites: 80,
      prebidSites: 60,
      versionDistribution: {
        'v1.0.0': 50,      // release
        'v2.0.0-pre': 10, // build
        'v3.0-custom': 5, // custom
        '9.35': 34        // custom (no full semver)
      },
      moduleDistribution: {
        'rubiconBidAdapter': 70,
        'id5IdSystem': 60,
        'rtdModule': 50,
        'adagioAnalyticsAdapter': 40,
        'otherModule': 30,
        'moduleBelowThreshold': 3 // Should be filtered out (MIN_COUNT_THRESHOLD = 5 in script)
      }
    };
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(mockSummarizationData));

    await cleanStats();

    const writeFileCall = vi.mocked(fsPromises.writeFile).mock.calls[0];
    const writtenData = JSON.parse(writeFileCall[1] as string);

    expect(writtenData.visitedSites).toBe(100);
    expect(writtenData.monitoredSites).toBe(80);
    expect(writtenData.prebidSites).toBe(60);
    expect(writtenData.releaseVersions).toEqual({ '1.0.0': 50 });
    expect(writtenData.buildVersions).toEqual({ '2.0.0-pre': 10 });
    expect(writtenData.customVersions).toEqual({ '3.0-custom': 5, '9.35': 34 });
    expect(writtenData.bidAdapterInst).toEqual({ 'rubiconBidAdapter': 70 });
    expect(writtenData.idModuleInst).toEqual({ 'id5IdSystem': 60 });
    expect(writtenData.rtdModuleInst).toEqual({ 'rtdModule': 50 });
    expect(writtenData.analyticsAdapterInst).toEqual({ 'adagioAnalyticsAdapter': 40 });
    expect(writtenData.otherModuleInst).toEqual({ 'otherModule': 30 });
    expect(writtenData.bidAdapterInst['moduleBelowThreshold']).toBeUndefined();
  });

  it('should correctly read summarization.json from api/ folder', async () => {
    vi.mocked(fsPromises.access).mockResolvedValue(undefined); // Dir exists for output

    await cleanStats(); // This will trigger readFile

    expect(fsPromises.readFile).toHaveBeenCalled();
    const readFileCall = vi.mocked(fsPromises.readFile).mock.calls[0];
    const filePath = readFileCall[0]; // First argument is the path
    const expectedPathSuffix = path.join('api', 'summarization.json');
    expect(String(filePath)).to.satisfy((s: string) => s.endsWith(expectedPathSuffix));
  });
});
