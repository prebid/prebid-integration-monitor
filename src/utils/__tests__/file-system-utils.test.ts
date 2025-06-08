import {
  readJsonFile,
  writeJsonFile,
  ensureDirectoryExists,
  readDirectory,
} from '../file-system-utils'; // .js extension resolved by Jest
import { AppError } from '../../common/AppError.js'; // Import AppError
import { Dirent, promises as fsPromises } from 'fs'; // Import Dirent directly for instanceof checks if needed
import { vi, describe, it, expect, beforeEach } from 'vitest';
import logger from '../logger.js';

// Mock fs module
vi.mock('fs', async (importOriginal) => {
  const originalModule = (await importOriginal()) as typeof import('fs');
  return {
    ...originalModule, // Spread original exports
    promises: {
      // Override promises property
      readFile: vi.fn(),
      writeFile: vi.fn(),
      mkdir: vi.fn(),
      readdir: vi.fn(),
      access: vi.fn(), // Not used by SUT but good to have if fsPromises.access was called
    },
  };
});

// Mock logger
vi.mock('../logger', () => ({
  default: {
    instance: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

describe('file-system-utils', () => {
  beforeEach(() => {
    // Clear all mock instances and calls to ensure test isolation
    vi.clearAllMocks();
  });

  describe('readJsonFile', () => {
    it('should parse valid JSON string from file', async () => {
      const mockData = { key: 'value', count: 123 };
      (fsPromises.readFile as vi.Mock).mockResolvedValue(
        JSON.stringify(mockData)
      );

      const data = await readJsonFile<{ key: string; count: number }>(
        'dummy/path.json'
      );
      expect(data).toEqual(mockData);
      expect(fsPromises.readFile).toHaveBeenCalledWith(
        'dummy/path.json',
        'utf8'
      );
    });

    it('should throw error for invalid JSON string', async () => {
      (fsPromises.readFile as vi.Mock).mockResolvedValue('invalid json');
      await expect(readJsonFile('dummy/path.json')).rejects.toThrow();
      expect(logger.instance.error).toHaveBeenCalled();
    });

    it('should propagate error if readFile fails', async () => {
      const mockError = new Error('File not found');
      (fsPromises.readFile as vi.Mock).mockRejectedValue(mockError);
      await expect(readJsonFile('dummy/path.json')).rejects.toSatisfy(
        (error: any) => {
          expect(error).toBeInstanceOf(AppError);
          expect(error.message).toContain(
            'Error processing JSON file dummy/path.json: Failed to read file.'
          );
          expect(error.details.originalError.message).toBe('File not found');
          return true;
        }
      );
      expect(logger.instance.error).toHaveBeenCalledWith(
        expect.stringContaining('dummy/path.json'),
        expect.objectContaining({ errorMessage: 'File not found' })
      );
    });
  });

  describe('writeJsonFile', () => {
    it('should call writeFile with stringified data', async () => {
      const mockData = { test: 'data' };
      (fsPromises.writeFile as vi.Mock).mockResolvedValue(undefined);

      await writeJsonFile('output/path.json', mockData);
      expect(fsPromises.writeFile).toHaveBeenCalledWith(
        'output/path.json',
        JSON.stringify(mockData, null, 2),
        'utf8'
      );
    });

    it('should propagate error if writeFile fails', async () => {
      const mockError = new Error('Permission denied');
      (fsPromises.writeFile as vi.Mock).mockRejectedValue(mockError);
      await expect(writeJsonFile('output/path.json', {})).rejects.toSatisfy(
        (error: any) => {
          expect(error).toBeInstanceOf(AppError);
          expect(error.message).toContain(
            'Failed to write JSON file: output/path.json'
          );
          expect(error.details.originalError.message).toBe('Permission denied');
          return true;
        }
      );
      expect(logger.instance.error).toHaveBeenCalled();
    });

    it('should propagate error if JSON.stringify fails (e.g. circular structure)', async () => {
      const circularObj: any = { a: 1 };
      circularObj.b = circularObj; // Create circular reference

      await expect(
        writeJsonFile('output/path.json', circularObj)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(AppError);
        expect(error.message).toContain(
          'Failed to write JSON file: output/path.json'
        ); // The AppError message
        expect(error.details.originalError).toBeInstanceOf(TypeError); // Check original error type
        expect(error.details.originalError.message).toContain(
          'circular structure'
        );
        return true;
      });
      expect(logger.instance.error).toHaveBeenCalled();
    });
  });

  describe('ensureDirectoryExists', () => {
    it('should call mkdir with recursive true', async () => {
      (fsPromises.mkdir as vi.Mock).mockResolvedValue(undefined);
      await ensureDirectoryExists('new/dir');
      expect(fsPromises.mkdir).toHaveBeenCalledWith('new/dir', {
        recursive: true,
      });
    });

    it('should propagate error if mkdir fails critically (and re-throws)', async () => {
      const mockError = new Error('Something went wrong');
      (fsPromises.mkdir as vi.Mock).mockRejectedValue(mockError);
      await expect(ensureDirectoryExists('new/dir')).rejects.toSatisfy(
        (error: any) => {
          expect(error).toBeInstanceOf(AppError);
          expect(error.message).toContain(
            'Failed to ensure directory exists: new/dir'
          );
          expect(error.details.originalError.message).toBe(
            'Something went wrong'
          );
          return true;
        }
      );
      expect(logger.instance.error).toHaveBeenCalled();
    });
  });

  describe('readDirectory', () => {
    it('should call readdir and return string array by default', async () => {
      const mockFilenames = ['file1.txt', 'file2.js'];
      (fsPromises.readdir as vi.Mock).mockResolvedValue(mockFilenames);

      const files = await readDirectory('some/path');
      expect(files).toEqual(mockFilenames);
      expect(fsPromises.readdir).toHaveBeenCalledWith('some/path');
    });

    it('should call readdir and return string array if withFileTypes is false', async () => {
      const mockFilenames = ['fileA.txt', 'fileB.js'];
      (fsPromises.readdir as vi.Mock).mockResolvedValue(mockFilenames);

      const files = await readDirectory('some/path', { withFileTypes: false });
      expect(files).toEqual(mockFilenames);
      expect(fsPromises.readdir).toHaveBeenCalledWith('some/path');
    });

    it('should call readdir with withFileTypes true and return Dirent array', async () => {
      // Simulate Dirent-like objects, actual Dirent constructor is not easily mockable here
      const mockDirents = [
        {
          name: 'file1.txt',
          isDirectory: () => false,
          isFile: () => true,
        } as Dirent,
        {
          name: 'subdir',
          isDirectory: () => true,
          isFile: () => false,
        } as Dirent,
      ];
      (fsPromises.readdir as vi.Mock).mockResolvedValue(mockDirents);

      const dirents = await readDirectory('some/path', { withFileTypes: true });
      expect(dirents).toEqual(mockDirents);
      expect(fsPromises.readdir).toHaveBeenCalledWith('some/path', {
        withFileTypes: true,
      });
      // Example check of Dirent properties (if needed)
      expect(dirents[0].name).toBe('file1.txt');
      expect(dirents[1].isDirectory()).toBe(true);
    });

    it('should propagate error if readdir fails', async () => {
      const mockError = new Error('Directory not found');
      (fsPromises.readdir as vi.Mock).mockRejectedValue(mockError);
      await expect(readDirectory('some/path')).rejects.toSatisfy(
        (error: any) => {
          expect(error).toBeInstanceOf(AppError);
          expect(error.message).toContain(
            'Failed to read directory: some/path'
          );
          expect(error.details.originalError.message).toBe(
            'Directory not found'
          );
          return true;
        }
      );
      expect(logger.instance.error).toHaveBeenCalled();
    });
  });
});
