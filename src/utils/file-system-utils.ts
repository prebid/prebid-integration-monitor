import { promises as fsPromises, Dirent } from 'fs';
import * as path from 'path';
import logger from './logger.js'; // Assuming logger is accessible here

/**
 * Ensures that a directory exists at the specified path.
 * If the directory (or any of its parent directories) does not exist, it will be created.
 *
 * @async
 * @function ensureDirectoryExists
 * @param {string} dirPath - The path to the directory that needs to exist.
 * @returns {Promise<void>} A promise that resolves when the directory exists (or has been created),
 *          or rejects if an error occurs during directory creation that cannot be handled by `recursive: true`.
 * @throws Will log an error using `logger.instance` if `fsPromises.mkdir` fails for unexpected reasons.
 */
export async function ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
        await fsPromises.mkdir(dirPath, { recursive: true });
    } catch (error: any) {
        // Log the error.
        logger.instance.error(`Error ensuring directory ${dirPath} exists:`, {
            errorName: error.name,
            errorMessage: error.message,
            // stack: error.stack // Optionally log stack for more details
        });
        // Rethrow the error so the caller is aware that directory creation failed,
        // as this is often a critical step.
        throw error;
    }
}

/**
 * Reads the content of a directory.
 * Overloaded function:
 * - Returns `Dirent[]` if `options.withFileTypes` is true.
 * - Returns `string[]` (filenames) otherwise or if `options` is undefined.
 *
 * @async
 * @function readDirectory
 * @param {string} dirPath - The path to the directory to read.
 * @param {object} [options] - Optional settings.
 * @param {boolean} [options.withFileTypes=false] - If true, returns an array of `Dirent` objects, otherwise returns an array of filenames.
 * @returns {Promise<string[] | Dirent[]>} A promise that resolves with an array of filenames or `Dirent` objects.
 * @throws Will log an error and potentially rethrow if `fsPromises.readdir` fails.
 * @example
 * // Read filenames
 * const files = await readDirectory('./my-dir');
 * // Read with file types
 * const dirents = await readDirectory('./my-dir', { withFileTypes: true });
 * if (dirents.length > 0 && dirents[0] instanceof Dirent && dirents[0].isDirectory()) {
 *   console.log(`${dirents[0].name} is a directory.`);
 * }
 */
export async function readDirectory(dirPath: string, options: { withFileTypes: true }): Promise<Dirent[]>;
export async function readDirectory(dirPath: string, options?: { withFileTypes?: false }): Promise<string[]>;
export async function readDirectory(dirPath: string, options?: { withFileTypes?: boolean }): Promise<string[] | Dirent[]> {
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
        throw error; // Rethrow to allow caller to handle critical errors like EACCES or ENOENT
    }
}

/**
 * Reads and parses a JSON file into a TypeScript type.
 *
 * @async
 * @function readJsonFile
 * @template T - The expected type of the parsed JSON data.
 * @param {string} filePath - The path to the JSON file.
 * @returns {Promise<T>} A promise that resolves with the parsed JSON data as type `T`.
 * @throws Will log an error and rethrow if file reading or JSON parsing fails.
 *         This allows the caller to handle specific error scenarios (e.g., file not found, invalid JSON).
 * @example
 * interface MyData { foo: string; bar: number; }
 * try {
 *   const data = await readJsonFile<MyData>('./data.json');
 *   console.log(data.foo);
 * } catch (e) {
 *   // Handle file not found or JSON parse error
 * }
 */
export async function readJsonFile<T>(filePath: string): Promise<T> {
    try {
        const fileContent: string = await fsPromises.readFile(filePath, 'utf8');
        return JSON.parse(fileContent) as T;
    } catch (error: any) {
        logger.instance.error(`Error reading or parsing JSON file ${filePath}:`, {
            errorName: error.name,
            errorMessage: error.message,
            // stack: error.stack // Optional: for more detailed debugging
        });
        throw error; // Rethrow for the caller to handle
    }
}

/**
 * Writes data to a JSON file, creating the file if it doesn't exist and overwriting it if it does.
 * The data is stringified with pretty printing (2-space indentation).
 *
 * @async
 * @function writeJsonFile
 * @param {string} filePath - The path to the file where the JSON data will be written.
 * @param {any} data - The data to be stringified and written to the file.
 * @returns {Promise<void>} A promise that resolves when the file has been successfully written.
 * @throws Will log an error and rethrow if writing the file fails.
 * @example
 * try {
 *   await writeJsonFile('./output.json', { message: 'Hello world' });
 * } catch (e) {
 *   // Handle file writing error
 * }
 */
export async function writeJsonFile(filePath: string, data: any): Promise<void> {
    try {
        const jsonData: string = JSON.stringify(data, null, 2);
        await fsPromises.writeFile(filePath, jsonData, 'utf8');
    } catch (error: any) {
        logger.instance.error(`Error writing JSON file ${filePath}:`, {
            errorName: error.name,
            errorMessage: error.message,
        });
        throw error; // Rethrow for the caller to handle
    }
}
