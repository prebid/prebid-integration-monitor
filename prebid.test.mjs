// prebid.test.mjs
import { describe, it, expect, vi, beforeEach, afterEach, test } from 'vitest';
import * as fsOriginal from 'node:fs'; // Import original fs for some utility if needed, or for the mock structure

// Mock 'node:fs'
const mockFsOperations = {
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
};

vi.mock('node:fs', async (importOriginal) => {
  const actualFs = await importOriginal();
  return {
    ...actualFs,
    ...mockFsOperations,
    default: { // For CJS compatibility if prebid.js is treated as CJS by test runner in some contexts
      ...actualFs,
      ...mockFsOperations,
    }
  };
});

// Mock 'puppeteer-cluster'
const mockPage = {
  setUserAgent: vi.fn().mockResolvedValue(),
  setDefaultTimeout: vi.fn(),
  goto: vi.fn().mockResolvedValue(),
  evaluate: vi.fn().mockResolvedValue({}), // Default to empty object
  // Add other page methods if they are called and need mocking
};

let storedTaskFunction = null;
let storedTaskResultCallback = null;

const mockClusterInstance = {
  task: vi.fn(async (callback) => {
    storedTaskFunction = callback; // Store the task function
  }),
  queue: vi.fn(async (url, taskResultCb) => {
    // Simulate task execution:
    // In a real scenario, the cluster would manage page creation.
    // For testing, we pass a predefined mockPage.
    // The taskResultCb is the function prebid.js provides to handle results from the task.
    if (storedTaskFunction) {
      try {
        const result = await storedTaskFunction({ page: mockPage, data: url });
        if (taskResultCb) {
          taskResultCb(result);
        }
      } catch (error) {
        // This catch is for errors *within the task function itself* if not caught by its own try/catch
        // and if taskResultCb is designed to handle it or if we want to test unhandled errors.
        // However, prebid.js task function has its own try/catch which should return error objects.
        if (taskResultCb) {
          taskResultCb({ status: 'unhandled_task_error', url, error: error.message });
        }
      }
    }
  }),
  idle: vi.fn().mockResolvedValue(),
  close: vi.fn().mockResolvedValue(),
  // _taskFn: null, // Replaced by storedTaskFunction
  // _taskResultCallback: null, // Replaced by storedTaskResultCallback
};

const Cluster = {
  launch: vi.fn(() => Promise.resolve(mockClusterInstance)),
  CONCURRENCY_PAGE: 'CONCURRENCY_PAGE', // Match actual value if used
};
vi.mock('puppeteer-cluster', () => ({ Cluster }));

// Dynamically import prebidExplorer AFTER mocks are set up
// Important: prebid.js uses ESM 'import * as fs'. The mock should handle this.
// The fs mock factory handles 'default' for potential CJS interop, and direct exports for ESM.
let prebidExplorer;

describe('prebid.js Tests', () => {
  beforeEach(async () => {
    // Reset all mocks before each test
    vi.resetAllMocks();

    // Reset fs mock implementations specifically if needed (e.g., default return values)
    mockFsOperations.readFileSync.mockReset();
    mockFsOperations.writeFileSync.mockReset();
    mockFsOperations.appendFileSync.mockReset();
    mockFsOperations.existsSync.mockReset().mockReturnValue(true); // Default to directory exists
    mockFsOperations.mkdirSync.mockReset();

    // Reset puppeteer mock implementations
    mockPage.setUserAgent.mockClear();
    mockPage.setDefaultTimeout.mockClear();
    mockPage.goto.mockReset().mockResolvedValue({}); // Default success
    mockPage.evaluate.mockReset().mockResolvedValue({ libraries: [], prebidInstances: [] }); // Default no data

    // Reset cluster mocks
    Cluster.launch.mockClear().mockResolvedValue(mockClusterInstance);
    mockClusterInstance.task.mockClear();
    mockClusterInstance.queue.mockClear();
    mockClusterInstance.idle.mockClear().mockResolvedValue();
    mockClusterInstance.close.mockClear().mockResolvedValue();
    storedTaskFunction = null;
    storedTaskResultCallback = null; // ensure this is reset

    // Spy on console methods
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Import the module to test - prebid.js. Default export if it's `export default async function ...`
    // If prebid.js is `export async function prebidExplorer`, then it's a named import.
    // Assuming prebid.js has `prebidExplorer();` at the end, it doesn't export.
    // For testing, prebid.js should export prebidExplorer.
    // Let's assume prebid.js is modified to: `export async function prebidExplorer() {...}`
    // And the call `prebidExplorer()` at the end is removed or conditional.
    // For now, to make it testable without modifying prebid.js source on this turn,
    // we will rely on the fact that prebid.js is an ES module and its top-level code will run.
    // This is tricky. A better approach is to ensure prebid.js exports the function.
    // For the purpose of this exercise, let's assume prebid.js is refactored to export prebidExplorer.
    const module = await import('../prebid.js'); // Adjust path if necessary
    prebidExplorer = module.default; // Or specific named export if changed
    // If prebid.js is not exporting, this will fail.
    // Let's assume for now prebid.js is changed to:
    // export default async function prebidExplorer() { ... }
    // And the direct invocation prebidExplorer() is removed from prebid.js
    // For the purpose of this test, we will assume prebid.js is modified to export prebidExplorer
    // e.g., in prebid.js: export default async function prebidExplorer() { ... }
    // and the direct call prebidExplorer(); is removed or conditional.
    // This dynamic import will pull in the (assumed) default export.
    const module = await import('../prebid.js?t=' + Date.now()); // Cache bust for re-import
    prebidExplorer = module.default;
    if (typeof prebidExplorer !== 'function') {
        throw new Error("prebidExplorer function not found. Ensure prebid.js exports it as default.");
    }
  });

  afterEach(() => {
    // vi.restoreAllMocks(); // Handled by resetAllMocks in beforeEach
  });

  describe('Basic Success Case', () => {
    it('should correctly process URLs, identify libraries, and write files', async () => {
      // --- Arrange ---
      const urls = [
        'https://example.com/with-prebid',
        'https://example.com/with-googletag',
        'https://example.com/no-libs',
      ].join('\n');
      mockFsOperations.readFileSync.mockReturnValue(urls);
      mockFsOperations.existsSync.mockReturnValue(true); // Assume output/errors dirs exist

      // Mock page.evaluate responses based on URL
      mockPage.evaluate.mockImplementation(async () => {
        // @ts-ignore
        const currentUrl = mockPage.goto.mock.calls[mockPage.goto.mock.calls.length - 1][0];
        if (currentUrl === 'https://example.com/with-prebid') {
          return {
            libraries: ['googletag'],
            prebidInstances: [{ globalVarName: 'pbjs', version: '8.0.0', modules: ['moduleA'] }],
            date: '2024-01-01'
          };
        }
        if (currentUrl === 'https://example.com/with-googletag') {
          return {
            libraries: ['googletag'],
            prebidInstances: [],
            date: '2024-01-01'
          };
        }
        if (currentUrl === 'https://example.com/no-libs') {
          return {
            libraries: [],
            prebidInstances: [],
            date: '2024-01-01'
          };
        }
        return { libraries: [], prebidInstances: [] };
      });

      // --- Act ---
      await prebidExplorer();

      // --- Assert ---
      // 1. Cluster behavior
      expect(Cluster.launch).toHaveBeenCalledTimes(1);
      expect(mockClusterInstance.task).toHaveBeenCalledTimes(1);
      expect(mockClusterInstance.queue).toHaveBeenCalledTimes(3);
      expect(mockClusterInstance.queue).toHaveBeenCalledWith('https://example.com/with-prebid', expect.any(Function));
      expect(mockClusterInstance.queue).toHaveBeenCalledWith('https://example.com/with-googletag', expect.any(Function));
      expect(mockClusterInstance.queue).toHaveBeenCalledWith('https://example.com/no-libs', expect.any(Function));
      expect(mockClusterInstance.idle).toHaveBeenCalledTimes(1);
      expect(mockClusterInstance.close).toHaveBeenCalledTimes(1);

      // 2. File writing operations (content check is more complex, focus on calls and types of data)
      // Results file (e.g., output/Month/YYYY-MM-DD.json)
      const appendFileCalls = mockFsOperations.appendFileSync.mock.calls;
      const resultFileCall = appendFileCalls.find(call => call[0].includes('.json'));
      expect(resultFileCall).toBeDefined();

      const writtenResults = JSON.parse("[" + resultFileCall[1].trim().split('\n').join(',') + "]");
      expect(writtenResults).toHaveLength(2); // with-prebid, with-googletag
      expect(writtenResults[0]).toEqual(expect.objectContaining({
        url: 'https://example.com/with-prebid',
        libraries: ['googletag'],
        prebidInstances: [{ globalVarName: 'pbjs', version: '8.0.0', modules: ['moduleA'] }]
      }));
      expect(writtenResults[1]).toEqual(expect.objectContaining({
        url: 'https://example.com/with-googletag',
        libraries: ['googletag']
      }));

      // no_prebid.txt
      const noPrebidFileCall = appendFileCalls.find(call => call[0].includes('no_prebid.txt'));
      expect(noPrebidFileCall).toBeDefined();
      expect(noPrebidFileCall[1]).toContain('https://example.com/no-libs');

      // error_processing.txt should not be called if no errors
      const errorFileCall = appendFileCalls.find(call => call[0].includes('error_processing.txt'));
      expect(errorFileCall).toBeUndefined();

      // input.txt update
      expect(mockFsOperations.writeFileSync).toHaveBeenCalledWith('input.txt', '', 'utf8'); // All URLs processed

      // 3. Console logs (optional, but good for sanity)
      expect(console.log).toHaveBeenCalledWith('Loaded 3 URLs from input.txt.');
      expect(console.log).toHaveBeenCalledWith('All URLs processed. Writing results...');
    });
  });

  describe('Error Handling Cases', () => {
    it('should correctly handle page.goto errors and write to error_processing.txt', async () => {
      // --- Arrange ---
      const urls = [
        'https://example.com/good-url',
        'https://example.com/goto-error',
        'https://example.com/another-good-url',
      ].join('\n');
      mockFsOperations.readFileSync.mockReturnValue(urls);
      mockFsOperations.existsSync.mockReturnValue(true);

      mockPage.goto.mockImplementation(async (url) => {
        if (url === 'https://example.com/goto-error') {
          const error = new Error('net::ERR_NAME_NOT_RESOLVED');
          // @ts-ignore
          error.message = 'net::ERR_NAME_NOT_RESOLVED'; // Puppeteer often has message as the code itself
          throw error;
        }
        return Promise.resolve({});
      });

      mockPage.evaluate.mockImplementation(async () => {
        // @ts-ignore
        const currentUrl = mockPage.goto.mock.calls[mockPage.goto.mock.calls.length - 1][0];
        if (currentUrl === 'https://example.com/good-url' || currentUrl === 'https://example.com/another-good-url') {
          return { libraries: ['ats'], prebidInstances: [], date: '2024-01-02' };
        }
        return { libraries: [], prebidInstances: [] }; // Should not be called for error URL
      });

      // --- Act ---
      await prebidExplorer();

      // --- Assert ---
      // Cluster behavior
      expect(mockClusterInstance.queue).toHaveBeenCalledTimes(3);

      // File writing
      const appendFileCalls = mockFsOperations.appendFileSync.mock.calls;

      // Results file for good URLs
      const resultFileCall = appendFileCalls.find(call => call[0].includes('.json'));
      expect(resultFileCall).toBeDefined();
      const writtenResults = JSON.parse("[" + resultFileCall[1].trim().split('\n').join(',') + "]");
      expect(writtenResults).toHaveLength(2);
      expect(writtenResults[0].url).toBe('https://example.com/good-url');
      expect(writtenResults[1].url).toBe('https://example.com/another-good-url');

      // error_processing.txt
      const errorFileCall = appendFileCalls.find(call => call[0].includes('error_processing.txt'));
      expect(errorFileCall).toBeDefined();
      expect(errorFileCall[1]).toContain('https://example.com/goto-error,ERR_NAME_NOT_RESOLVED');

      // no_prebid.txt should not be called for these successful lib detections
      const noPrebidFileCall = appendFileCalls.find(call => call[0].includes('no_prebid.txt'));
      expect(noPrebidFileCall).toBeUndefined();


      // input.txt update - all URLs attempted, so all removed
      expect(mockFsOperations.writeFileSync).toHaveBeenCalledWith('input.txt', '', 'utf8');
    });

    it('should correctly handle page.evaluate errors and write to error_processing.txt', async () => {
      // --- Arrange ---
      const urls = "https://example.com/eval-error\nhttps://example.com/normal-url";
      mockFsOperations.readFileSync.mockReturnValue(urls);
      mockFsOperations.existsSync.mockReturnValue(true);

      mockPage.evaluate.mockImplementation(async () => {
        // @ts-ignore
        const currentUrl = mockPage.goto.mock.calls[mockPage.goto.mock.calls.length - 1][0];
        if (currentUrl === 'https://example.com/eval-error') {
          throw new Error('Simulated evaluation error');
        }
        if (currentUrl === 'https://example.com/normal-url') {
            return { libraries: ['googletag'], date: '2024-01-03' };
        }
        return {};
      });

      // --- Act ---
      await prebidExplorer();

      // --- Assert ---
      const appendFileCalls = mockFsOperations.appendFileSync.mock.calls;
      const errorFileCall = appendFileCalls.find(call => call[0].includes('error_processing.txt'));
      expect(errorFileCall).toBeDefined();
      expect(errorFileCall[1]).toContain('https://example.com/eval-error,SIMULATED_EVALUATION_ERROR');

      const resultFileCall = appendFileCalls.find(call => call[0].includes('.json'));
      expect(resultFileCall).toBeDefined();
      expect(resultFileCall[1]).toContain('https://example.com/normal-url');


      expect(mockFsOperations.writeFileSync).toHaveBeenCalledWith('input.txt', '', 'utf8');
    });

    it('should log DETACHED IFRAME errors and add to error_processing.txt', async () => {
      const urls = "https://example.com/detached-iframe";
      mockFsOperations.readFileSync.mockReturnValue(urls);
      mockFsOperations.existsSync.mockReturnValue(true);

      mockPage.goto.mockImplementation(async (url) => {
        if (url === 'https://example.com/detached-iframe') {
          throw new Error('Target page, context or browser has been closed (DETACHED IFRAME)');
        }
        return Promise.resolve({});
      });

      await prebidExplorer();

      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Detached iframe or target closed error detected for https://example.com/detached-iframe'));
      const errorFileCall = mockFsOperations.appendFileSync.mock.calls.find(call => call[0].includes('error_processing.txt'));
      expect(errorFileCall).toBeDefined();
      expect(errorFileCall[1]).toContain('https://example.com/detached-iframe,TARGET_PAGE_CONTEXT_OR_BROWSER_HAS_BEEN_CLOSED_(DETACHED_IFRAME)');
    });
  });

  describe('Empty Input File', () => {
    it('should handle an empty input.txt file gracefully', async () => {
      // --- Arrange ---
      mockFsOperations.readFileSync.mockReturnValue(''); // Empty file
      mockFsOperations.existsSync.mockReturnValue(true);


      // --- Act ---
      await prebidExplorer();

      // --- Assert ---
      expect(console.log).toHaveBeenCalledWith('No URLs found in input.txt. Exiting.');
      expect(Cluster.launch).not.toHaveBeenCalled(); // Cluster should not even launch
      expect(mockClusterInstance.queue).not.toHaveBeenCalled();

      // No files should be written, beyond perhaps an empty input.txt
      expect(mockFsOperations.appendFileSync).not.toHaveBeenCalled();

      // input.txt might be written as empty if it was read and processed as such,
      // or not touched if the script exits early.
      // Current prebid.js logic with early exit: it won't call writeFileSync for input.txt.
      // If it did, it would be: expect(mockFsOperations.writeFileSync).toHaveBeenCalledWith('input.txt', '', 'utf8');
      // Based on current prebid.js:
      // if (allUrls.length === 0) { console.log("No URLs found..."); return; }
      // So, no further processing, no file writes.
      expect(mockFsOperations.writeFileSync).not.toHaveBeenCalled();
    });

    it('should handle input.txt with only whitespace gracefully', async () => {
      // --- Arrange ---
      mockFsOperations.readFileSync.mockReturnValue('   \n\r\n   \t   '); // Whitespace only
      mockFsOperations.existsSync.mockReturnValue(true);

      // --- Act ---
      await prebidExplorer();

      // --- Assert ---
      expect(console.log).toHaveBeenCalledWith('No URLs found in input.txt. Exiting.');
      expect(Cluster.launch).not.toHaveBeenCalled();
      expect(mockFsOperations.appendFileSync).not.toHaveBeenCalled();
      expect(mockFsOperations.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('Page Configuration Calls', () => {
    it('should call page.setUserAgent and page.setDefaultTimeout for each task', async () => {
      // --- Arrange ---
      const urls = 'https://example.com/test-config';
      mockFsOperations.readFileSync.mockReturnValue(urls);
      mockFsOperations.existsSync.mockReturnValue(true); // Assume output/errors dirs exist

      // Act
      await prebidExplorer();

      // Assert
      // Ensure the task function was actually called by the queue mock
      expect(mockClusterInstance.queue).toHaveBeenCalledTimes(1);

      // Check if the page configuration methods were called
      // These methods are on mockPage, which is passed into the storedTaskFunction
      expect(mockPage.setUserAgent).toHaveBeenCalledTimes(1);
      expect(mockPage.setUserAgent).toHaveBeenCalledWith('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');
      expect(mockPage.setDefaultTimeout).toHaveBeenCalledTimes(1);
      expect(mockPage.setDefaultTimeout).toHaveBeenCalledWith(55000);

      // Also good to check that goto was called, indicating the task ran
      expect(mockPage.goto).toHaveBeenCalledTimes(1);
      expect(mockPage.goto).toHaveBeenCalledWith('https://example.com/test-config', expect.objectContaining({ waitUntil: 'domcontentloaded' }));
    });
  });

});

// Note: For this to work, prebid.js needs to export its main function.
// e.g., change `async function prebidExplorer() {` to `export default async function prebidExplorer() {`
// and remove the direct call `prebidExplorer();` from the end of prebid.js.
// If that modification to prebid.js is not allowed in this step,
// testing its current side-effect-only execution is much harder and would require different techniques.
// The prompt implies we are developing tests for prebid.js as it is or with minimal changes for testability.
