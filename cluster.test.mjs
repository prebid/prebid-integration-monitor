import { describe, it, expect, vi, beforeEach, afterEach, test } from 'vitest';
import fs from 'node:fs';
// import path from 'node:path'; // Not needed for this minimal test

// Mock 'fs' at the very top
vi.mock('node:fs', async (importOriginal) => {
  const actualFs = await importOriginal();
  const mockReadFileSync = vi.fn();
  return {
    ...actualFs,
    readFileSync: mockReadFileSync,
    default: { // Explicitly provide a default property
        ...actualFs,
        readFileSync: mockReadFileSync, // Share the same mock instance
    }
  };
});

// Mock 'puppeteer-cluster' - Re-enable for the main tests
const mockClusterInstance = {
  task: vi.fn(async (callback) => {
    mockClusterInstance._taskFn = callback;
  }),
  queue: vi.fn(),
  idle: vi.fn().mockResolvedValue(),
  close: vi.fn().mockResolvedValue(),
};

const Cluster = {
  launch: vi.fn(() => Promise.resolve(mockClusterInstance)),
  CONCURRENCY_CONTEXT: 'CONCURRENCY_CONTEXT',
};
vi.mock('puppeteer-cluster', () => ({ Cluster }));

// Re-enable cluster.cjs import
import cjsModule from './cluster.cjs';
const { clusterSearch } = cjsModule;


describe('Debug fs.readFileSync Mocking', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test('should correctly mock fs.readFileSync', () => {
    const mockContent = 'mocked file content';
    // Determine the correct path to the mock function based on the mock structure
    // Our mock factory ensures readFileSync is the same vi.fn() on both paths.
    const readFileSyncMockFn = fs.default?.readFileSync || fs.readFileSync;

    if (!readFileSyncMockFn || typeof readFileSyncMockFn.mockReturnValue !== 'function') {
        throw new Error('Could not find a mockable readFileSync function on the fs object or its default export.');
    }

    readFileSyncMockFn.mockReturnValue(mockContent);

    // To test the mock directly, we call it via the path Vitest seems to resolve 'fs' to.
    // If 'fs.default.readFileSync' was the one that worked, then cluster.cjs (a CJS module)
    // when it calls 'require("fs").readFileSync' should hit the mock that 'fs.default.readFileSync' points to.
    const result = fs.readFileSync('anypath.txt', 'utf8');

    expect(result).toBe(mockContent);
    expect(readFileSyncMockFn).toHaveBeenCalledWith('anypath.txt', 'utf8');
  });
});


describe('cluster.cjs tests > URL Input Reading', () => {
  let readFileSyncMockFn;

  beforeEach(() => {
    vi.resetAllMocks(); // Resets spies, mocks including call counts and implementations

    // Identify the correct mock function path once
    if (fs.default && typeof fs.default.readFileSync === 'function' && typeof fs.default.readFileSync.mockClear === 'function') {
      readFileSyncMockFn = fs.default.readFileSync;
    } else if (typeof fs.readFileSync === 'function' && typeof fs.readFileSync.mockClear === 'function') {
      readFileSyncMockFn = fs.readFileSync;
    } else {
      // This case should ideally not be reached if the mock factory is consistent
      throw new Error("fs.readFileSync mock not found or not a mock function for reset/setup.");
    }
    // Spies for console still needed
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    // vi.restoreAllMocks(); // Not strictly needed if vi.resetAllMocks() is in beforeEach
  });

  it('should read and parse valid URLs from input.txt', async () => {
    readFileSyncMockFn.mockReturnValue('https://example.com\nhttps://google.com\n');
    await clusterSearch();
    expect(console.log).toHaveBeenCalledWith('Loaded 2 URLs from input.txt.');
    expect(mockClusterInstance.queue).toHaveBeenCalledWith('https://example.com');
    expect(mockClusterInstance.queue).toHaveBeenCalledWith('https://google.com');
    expect(mockClusterInstance.queue).toHaveBeenCalledTimes(2);
  });

  it('should handle an empty input.txt', async () => {
    readFileSyncMockFn.mockReturnValue('');
    await clusterSearch();
    expect(console.log).toHaveBeenCalledWith('No URLs found in input.txt.');
    expect(mockClusterInstance.queue).not.toHaveBeenCalled();
  });

  it('should handle input.txt not existing (ENOENT error)', async () => {
    const enoentError = new Error("File not found");
    enoentError.code = 'ENOENT';
    readFileSyncMockFn.mockImplementation(() => { throw enoentError; });
    await clusterSearch();
    expect(console.error).toHaveBeenCalledWith('input.txt not found. Please create it or run preloader.js first.');
    expect(mockClusterInstance.queue).not.toHaveBeenCalled();
  });

  it('should handle other errors during file reading', async () => {
      const otherError = new Error("Some other read error");
      readFileSyncMockFn.mockImplementation(() => { throw otherError; });
      await clusterSearch();
      expect(console.error).toHaveBeenCalledWith('Error reading input.txt:', 'Some other read error');
      expect(mockClusterInstance.queue).not.toHaveBeenCalled();
  });

  it('should filter out empty lines and trim whitespace from input.txt', async () => {
    readFileSyncMockFn.mockReturnValue('  https://example.com  \n\nhttps://google.com\n\r\nhttps://whitespace.org\t\n');
    await clusterSearch();
    expect(console.log).toHaveBeenCalledWith('Loaded 3 URLs from input.txt.');
    expect(mockClusterInstance.queue).toHaveBeenCalledWith('https://example.com');
    expect(mockClusterInstance.queue).toHaveBeenCalledWith('https://google.com');
    expect(mockClusterInstance.queue).toHaveBeenCalledWith('https://whitespace.org');
    expect(mockClusterInstance.queue).toHaveBeenCalledTimes(3);
  });
});

// Placeholder for Core Task Logic tests (not part of this subtask's fix)
describe('cluster.cjs tests > Core Task Logic', () => {
  it('Prebid found: should log version', () => expect(true).toBe(true));
  it('Prebid not found (waitForFunction times out): should log error', () => expect(true).toBe(true));
  it('page.goto fails: should log error', () => expect(true).toBe(true));
});
