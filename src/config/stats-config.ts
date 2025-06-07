import * as path from 'path';
import { fileURLToPath } from 'url';

// Resolve __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * @const {string} PROJECT_ROOT
 * @description The absolute path to the project's root directory.
 * Assumes this config file is at `src/config/stats-config.ts`.
 */
export const PROJECT_ROOT: string = path.resolve(__dirname, '..', '..');

/**
 * @const {string} OUTPUT_DIR
 * @description The directory where raw scan data is stored, typically organized into monthly subfolders.
 * Resolved relative to the project root.
 */
export const OUTPUT_DIR: string = path.join(PROJECT_ROOT, 'store');

/**
 * @const {string} FINAL_API_FILE_PATH
 * @description The full path to the output JSON file (`api.json`) that contains the aggregated statistics.
 * Resolved relative to the project root.
 */
export const FINAL_API_FILE_PATH: string = path.join(
  PROJECT_ROOT,
  'api',
  'api.json',
);

/**
 * @const {number} MIN_COUNT_THRESHOLD
 * @description The minimum count for a module or version to be included in certain aggregated statistics.
 * This helps filter out noise from very low-frequency items.
 */
export const MIN_COUNT_THRESHOLD: number = 5;

/**
 * @const {RegExp} MONTH_ABBR_REGEX
 * @description Regular expression to identify month-named directories (e.g., "Jan", "Feb").
 */
export const MONTH_ABBR_REGEX: RegExp = /^[A-Z][a-z]{2}$/;

/**
 * @const {object} DEFAULT_MODULE_CATEGORIES
 * @description Configuration object for categorizing Prebid.js modules.
 * Each key represents a module category (e.g., `bidAdapter`, `idModule`).
 * The value for each key is a predicate function that takes a module name (string)
 * and returns `true` if the module belongs to that category, `false` otherwise.
 *
 * @property {function(string): boolean} bidAdapter - Identifies bid adapter modules.
 * @property {function(string): boolean} idModule - Identifies ID system modules.
 * @property {function(string): boolean} rtdModule - Identifies Real-Time Data (RTD) modules.
 * @property {function(string): boolean} analyticsAdapter - Identifies analytics adapter modules.
 */
export const DEFAULT_MODULE_CATEGORIES: {
  [key: string]: (name: string) => boolean;
} = {
  bidAdapter: (name: string): boolean => name.includes('BidAdapter'),
  idModule: (name: string): boolean =>
    name.includes('IdSystem') ||
    [
      'userId',
      'idImportLibrary',
      'pubCommonId',
      'utiqSystem',
      'trustpidSystem',
    ].includes(name),
  rtdModule: (name: string): boolean =>
    name.includes('Rtd' + 'Provider') || name === 'rtdModule', // Forcing re-evaluation of 'RtdProvider'
  analyticsAdapter: (name: string): boolean =>
    name.includes('AnalyticsAdapter'),
};
