/**
 * @fileoverview This file contains shared type definitions used across multiple
 * modules within the Prebid Explorer application. Centralizing these types
 * helps avoid circular dependencies and ensures consistency in data structures
 * passed between different parts of the system.
 */

import type { DetailedError } from '../utils/error-types.js';

/**
 * Represents a specific Prebid.js instance found on a web page.
 * Contains details about its global variable name, version, and loaded modules.
 */
export interface PrebidInstance {
  /**
   * The global variable name under which the Prebid.js instance is available.
   * @example "pbjs"
   */
  globalVarName: string;
  /**
   * The version string of the Prebid.js instance.
   * @example "7.53.0"
   */
  version: string;
  /**
   * An array of strings, where each string is the name of an installed Prebid.js module.
   * @example ["consentManagement", "gptPreAuction", "dfpAdServerVideo"]
   */
  modules: string[];
}

/**
 * Encapsulates all relevant advertising technology data extracted from a single web page.
 * This includes detected ad libraries, the scan date, any Prebid.js instances, and the page URL.
 *
 * @example
 * const examplePageData: PageData = {
 *   libraries: ["googletag", "apstag"],
 *   date: "2023-10-26",
 *   prebidInstances: [
 *     { globalVarName: "pbjs", version: "7.53.0", modules: ["consentManagement", "gptPreAuction"] }
 *   ],
 *   url: "https://www.example.com"
 * };
 */
export interface PageData {
  /**
   * An array of strings identifying ad libraries detected on the page.
   * @example ["googletag", "apstag", "ats"]
   */
  libraries: string[];
  /**
   * An array of detected identity solutions (UID2.0, ID5, Parrable, etc).
   * @example ["UID2.0", "ID5"]
   */
  identitySolutions?: string[];
  /**
   * An array of detected Customer Data Platforms.
   * @example ["Tealium", "Segment", "Adobe"]
   */
  cdpPlatforms?: string[];
  /**
   * Detected Consent Management Platform information.
   * Always present but may be empty object if no CMP detected.
   * @example { name: "OneTrust", version: "6.34.0", tcfVersion: "2.2" }
   */
  cmpInfo: {
    name?: string;
    version?: string;
    tcfVersion?: string;
    gdprApplies?: boolean;
    ccpaApplies?: boolean;
    consentString?: string;
  };
  /**
   * Unknown ad tech discovered in discovery mode.
   * Contains variable names and properties for further analysis.
   */
  unknownAdTech?: Array<{
    variable: string;
    hasVersion: boolean;
    hasFunctions: boolean;
    properties: string[];
  }>;
  /**
   * The date the page was scanned, formatted as YYYY-MM-DD.
   * @example "2023-10-26"
   */
  date: string;
  /**
   * An optional array of {@link PrebidInstance} objects, representing each
   * Prebid.js instance found on the page. Undefined if no instances are found.
   */
  prebidInstances?: PrebidInstance[];
  /**
   * The URL of the page from which the data was extracted.
   * @example "https://www.example.com/article"
   */
  url?: string;
  /**
   * Tool-specific metadata about the extraction process.
   * This is not actual page data but information about how the tool processed the page.
   */
  toolMetadata?: {
    /**
     * Initialization states for each Prebid instance, keyed by globalVarName.
     * @example { "pbjs": "complete", "pbjs2": "partial" }
     */
    prebidInitStates?: Record<string, 'complete' | 'partial' | 'queue'>;
  };
}

/**
 * Defines the possible string literal types for a task result's `type` property.
 * - `success`: Indicates that page processing was successful and data was extracted.
 * - `no_data`: Indicates that page processing was successful, but no relevant ad technology data was found.
 * - `error`: Indicates that an error occurred during page processing.
 */
export type TaskResultType = 'success' | 'no_data' | 'error';

/**
 * Represents a successful outcome of processing a web page.
 * Contains the extracted {@link PageData}.
 */
export interface TaskResultSuccess {
  /** Identifies the result type as successful. */
  type: 'success';
  /** The {@link PageData} extracted from the page. */
  data: PageData;
}

/**
 * Represents an outcome where page processing completed, but no relevant
 * advertising technology data (like Prebid.js) was detected.
 */
export interface TaskResultNoData {
  /** Identifies the result type as finding no relevant data. */
  type: 'no_data';
  /** The URL of the page that was processed. */
  url: string;
}

/**
 * Provides a structured way to describe errors that occur during page processing tasks.
 * @interface ErrorDetails
 */
export interface ErrorDetails {
  /**
   * A code representing the type of error.
   * @example 'NET_TIMEOUT', 'PBJS_NOT_FOUND', 'INTERNAL_ERROR'
   */
  code: string;
  /** A human-readable message describing the error. */
  message: string;
  /** Optional stack trace of the original error, if available. */
  stack?: string;
  /** Optional detailed error information with enhanced categorization. */
  detailedError?: DetailedError;
}

/**
 * Represents an outcome where an error occurred while attempting to process a page.
 * @interface TaskResultError
 */
export interface TaskResultError {
  /** Identifies the result type as an error. */
  type: 'error';
  /** The URL of the page that was being processed when the error occurred. */
  url: string;
  /**
   * An {@link ErrorDetails} object containing structured information about the error.
   */
  error: ErrorDetails;
}

/**
 * A discriminated union representing all possible outcomes of a page processing task.
 * Use the `type` property to determine the specific outcome and access relevant data.
 * @see {@link TaskResultSuccess}
 * @see {@link TaskResultNoData}
 * @see {@link TaskResultError}
 */
export type TaskResult = TaskResultSuccess | TaskResultNoData | TaskResultError;
