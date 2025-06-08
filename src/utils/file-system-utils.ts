import { promises as fsPromises, Dirent } from 'fs';
import logger from './logger.js'; // Assuming logger is accessible here
import { AppError, AppErrorDetails } from './../common/AppError.js';

/**
 * Ensures that a directory exists at the specified path.
 * If the directory (or any of its parent directories) does not exist, it will be created recursively.
 * Logs an error and throws an AppError if directory creation fails.
 *
 * @async
 * @function ensureDirectoryExists
 * @param {string} dirPath - The path to the directory that needs to exist.
 * @returns {Promise<void>} A promise that resolves when the directory exists (or has been created).
 * @throws {AppError} If directory creation fails (errorCode: `FS_MKDIR_FAILED`).
 *                    The original error will be included in `AppError.details.originalError`.
 */
export async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    await fsPromises.mkdir(dirPath, { recursive: true });
  } catch (error: any) {
    logger.instance.error(`Error ensuring directory ${dirPath} exists:`, {
      errorName: error.name,
      errorMessage: error.message,
    });
    const details: AppErrorDetails = {
      errorCode: 'FS_MKDIR_FAILED',
      originalError: error,
      dirPath,
    };
    throw new AppError(
      `Failed to ensure directory exists: ${dirPath}`,
      details
    );
  }
}

/**
 * Reads the content of a directory.
 * This is an overloaded function:
 * - If `options.withFileTypes` is true, it returns an array of `Dirent` objects.
 * - Otherwise (or if `options` is undefined), it returns an array of filenames (string[]).
 * Logs an error and throws an AppError if reading the directory fails.
 *
 * @async
 * @function readDirectory
 * @param {string} dirPath - The path to the directory to read.
 * @param {object} [options] - Optional settings for reading the directory.
 * @param {boolean} [options.withFileTypes=false] - If true, the method returns an array of `Dirent` objects,
 *                                                  otherwise it returns an array of filenames (strings).
 * @returns {Promise<string[] | Dirent[]>} A promise that resolves with an array of filenames (string[])
 *                                         or `Dirent` objects, depending on the options.
 * @throws {AppError} If reading the directory fails (errorCode: `FS_READDIR_FAILED`).
 *                    The original error will be included in `AppError.details.originalError`.
 * @example
 * // Read filenames
 * const files = await readDirectory('./my-dir');
 * // Read with file types
 * const dirents = await readDirectory('./my-dir', { withFileTypes: true });
 * if (dirents.length > 0 && dirents[0] instanceof Dirent && dirents[0].isDirectory()) {
 *   console.log(`${dirents[0].name} is a directory.`);
 * }
 */
export async function readDirectory(
  dirPath: string,
  options: { withFileTypes: true }
): Promise<Dirent[]>;
export async function readDirectory(
  dirPath: string,
  options?: { withFileTypes?: false }
): Promise<string[]>;
export async function readDirectory(
  dirPath: string,
  options?: { withFileTypes?: boolean }
): Promise<string[] | Dirent[]> {
  try {
    if (options?.withFileTypes) {
      return await fsPromises.readdir(dirPath, { withFileTypes: true });
    } else {
      return await fsPromises.readdir(dirPath);
    }
  } catch (error: any) {
    logger.instance.error(`Error reading directory ${dirPath}:`, {
      errorName: error.name,
      errorMessage: error.message,
    });
    const details: AppErrorDetails = {
      errorCode: 'FS_READDIR_FAILED',
      originalError: error,
      dirPath,
    };
    throw new AppError(`Failed to read directory: ${dirPath}`, details);
  }
}

/**
 * Reads and parses a JSON file into a specified generic type `T`.
 * Logs an error and throws an AppError if file reading or JSON parsing fails.
 *
 * @async
 * @function readJsonFile
 * @template T - The expected type of the parsed JSON data.
 * @param {string} filePath - The path to the JSON file.
 * @returns {Promise<T>} A promise that resolves with the parsed JSON data as type `T`.
 * @throws {AppError} If file reading fails (errorCode: `FS_READFILE_FAILED`).
 * @throws {AppError} If JSON parsing fails (errorCode: `JSON_PARSE_FAILED`).
 *                    The original error will be included in `AppError.details.originalError`.
 * @example
 * interface MyData { foo: string; bar: number; }
 * try {
 *   const data = await readJsonFile<MyData>('./data.json');
 *   console.log(data.foo);
 * } catch (e) {
 *   // Handle file not found, JSON parse error, or other AppError
 * }
 */
export async function readJsonFile<T>(filePath: string): Promise<T> {
  try {
    const fileContent: string = await fsPromises.readFile(filePath, 'utf8');
    return JSON.parse(fileContent) as T;
  } catch (error: any) {
    const baseErrorMessage = `Error processing JSON file ${filePath}`;
    let errorCode: string;
    let specificMessage: string;

    if (error instanceof SyntaxError) {
      errorCode = 'JSON_PARSE_FAILED';
      specificMessage = `${baseErrorMessage}: Invalid JSON syntax.`;
      logger.instance.error(specificMessage, {
        errorName: error.name,
        errorMessage: error.message,
        filePath,
        // stack: error.stack // Optional
      });
    } else {
      errorCode = 'FS_READFILE_FAILED';
      specificMessage = `${baseErrorMessage}: Failed to read file.`;
      logger.instance.error(specificMessage, {
        errorName: error.name,
        errorMessage: error.message,
        filePath,
        // stack: error.stack // Optional
      });
    }
    const details: AppErrorDetails = {
      errorCode,
      originalError: error,
      filePath,
    };
    throw new AppError(specificMessage, details);
  }
}

/**
 * Writes data to a JSON file.
 * The data is stringified with pretty printing (2-space indentation).
 * The function ensures the target directory exists before writing.
 * Logs an error and throws an AppError if writing the file fails.
 *
 * @async
 * @function writeJsonFile
 * @param {string} filePath - The path to the file where the JSON data will be written.
 *                           The directory for this path will be created if it doesn't exist.
 * @param {any} data - The data to be stringified and written to the file.
 * @returns {Promise<void>} A promise that resolves when the file has been successfully written.
 * @throws {AppError} If writing the file fails (errorCode: `FS_WRITEFILE_FAILED`).
 *                    The original error will be included in `AppError.details.originalError`.
 * @example
 * try {
 *   await writeJsonFile('./output/data.json', { message: 'Hello world' });
 * } catch (e) {
 *   // Handle file writing error
 * }
 */
export async function writeJsonFile(
  filePath: string,
  data: any
): Promise<void> {
  try {
    const jsonData: string = JSON.stringify(data, null, 2);
    await fsPromises.writeFile(filePath, jsonData, 'utf8');
  } catch (error: any) {
    logger.instance.error(`Error writing JSON file ${filePath}:`, {
      errorName: error.name,
      errorMessage: error.message,
    });
    const details: AppErrorDetails = {
      errorCode: 'FS_WRITEFILE_FAILED',
      originalError: error,
      filePath,
    };
    throw new AppError(`Failed to write JSON file: ${filePath}`, details);
  }
}
