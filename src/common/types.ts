/**
 * @fileoverview This file contains shared type definitions used across multiple
 * modules within the Prebid Explorer application. Centralizing these types
 * helps avoid circular dependencies and ensures consistency in data structures
 * passed between different parts of the system.
 */

import type { DetailedError } from '../utils/error-types.js';

/**
 * Represents details about an ad unit in Prebid.js
 */
export interface AdUnitInfo {
  /** The ad unit code/identifier */
  code: string;
  /** Media types configured for this ad unit */
  mediaTypes?: {
    banner?: {
      sizes?: number[][];
    };
    video?: {
      context?: string;
      playerSize?: number[][];
      mimes?: string[];
      protocols?: number[];
      maxduration?: number;
      api?: number[];
    };
    native?: {
      type?: string;
      native?: any;
    };
  };
  /** Number of bidders for this ad unit */
  bidderCount?: number;
}

/**
 * Represents a specific Prebid.js instance found on a web page.
 * Contains details about its global variable name, version, and loaded modules.
 */
export interface PrebidInstance {
  /**
   * The global variable name under which the Prebid.js instance is available.
   * @example "pbjs"
   */
  globalVarName?: string;
  /**
   * The version string of the Prebid.js instance.
   * @example "7.53.0"
   */
  version?: string;
  /**
   * The bidder timeout in milliseconds
   * @example 3000
   */
  timeout?: number | null;
  /**
   * The number of ad units configured
   * @example 5
   */
  adUnits?: number;
  /**
   * Simple array of media types when adUnitDetail is "basic"
   * @example ["banner", "video", "native"]
   */
  adUnitTypes?: string[];
  /**
   * Detailed information about ad units (if available)
   */
  adUnitDetails?: AdUnitInfo[];
  /**
   * An array of ACTIVE bidder codes configured in ad units
   * @example ["appnexus", "rubicon", "criteo"]
   */
  bidders?: string[];
  /**
   * An array of INACTIVE bid adapters that are installed but not configured
   * @example ["smilewantedBidAdapter", "adagioBidAdapter"]
   */
  inactiveBidAdapters?: string[];
  /**
   * An array of user ID modules that are configured
   * @example ["unifiedIdSystem", "id5IdSystem", "sharedIdSystem"]
   */
  userIds?: string[];
  /**
   * An array of analytics adapters that are configured
   * @example ["googleAnalyticsAdapter", "pubmaticAnalyticsAdapter"]
   */
  analyticsAdapters?: string[];
  /**
   * An array of Real-Time Data (RTD) modules that are configured
   * @example ["jwplayerRtdProvider", "permutiveRtdProvider", "browsiRtdProvider"]
   */
  rtdModules?: string[];
  /**
   * An array of video-related modules
   * @example ["dfpAdServerVideo", "freeWheelAdserverVideo", "adpod", "instreamTracking"]
   */
  videoModules?: string[];
  /**
   * An array of consent and privacy-related modules
   * @example ["consentManagement", "consentManagementGpp", "consentManagementUsp", "gdprEnforcement", "gppControl_usnat", "gppControl_usstates", "tcfControl"]
   */
  consentModules?: string[];
  /**
   * An array of remaining modules after categorization
   * @example ["gptPreAuction", "priceFloors", "enrichmentFpdModule"]
   */
  modules?: string[];
}

/**
 * Represents Schema.org structured data found on the page.
 * Can be from JSON-LD, microdata, or RDFa formats.
 */
export interface SchemaOrgData {
  /** Type of the schema (e.g., "Article", "Product", "Organization") */
  '@type'?: string | string[];
  /** Context URL */
  '@context'?: string | any;
  /** Any additional properties */
  [key: string]: any;
}

/**
 * Represents OpenGraph protocol metadata.
 */
export interface OpenGraphData {
  /** Basic OpenGraph tags */
  'og:type'?: string;
  'og:title'?: string;
  'og:description'?: string;
  'og:url'?: string;
  'og:site_name'?: string;
  'og:image'?: string | string[];
  /** Article-specific tags */
  'article:author'?: string;
  'article:publisher'?: string;
  'article:section'?: string;
  'article:tag'?: string | string[];
  'article:published_time'?: string;
  'article:modified_time'?: string;
  /** Product-specific tags */
  'product:price:amount'?: string;
  'product:price:currency'?: string;
  'product:availability'?: string;
  'product:category'?: string;
  /** Additional OpenGraph properties */
  [key: string]: string | string[] | undefined;
}

/**
 * Represents Twitter Card metadata.
 */
export interface TwitterCardData {
  'twitter:card'?: string;
  'twitter:site'?: string;
  'twitter:creator'?: string;
  'twitter:title'?: string;
  'twitter:description'?: string;
  'twitter:image'?: string;
  /** Custom Twitter labels and data */
  [key: string]: string | undefined;
}

/**
 * Represents standard HTML meta tags.
 */
export interface StandardMetaTags {
  description?: string;
  keywords?: string;
  author?: string;
  generator?: string;
  'application-name'?: string;
  viewport?: string;
  robots?: string;
  /** Dublin Core metadata */
  'DC.type'?: string;
  'DC.subject'?: string;
  'DC.creator'?: string;
  'DC.publisher'?: string;
  /** News-specific */
  'news_keywords'?: string;
  /** Verification tags */
  'google-site-verification'?: string;
  'msvalidate.01'?: string;
  /** Additional meta tags */
  [key: string]: string | undefined;
}

/**
 * Site categorization signals extracted from the page.
 */
export interface SiteCategorizationData {
  /** URL path segments */
  urlPath: string[];
  /** Breadcrumb navigation items */
  breadcrumbs: string[];
  /** Main navigation menu items */
  navigationItems: string[];
  /** CSS classes on body element */
  bodyClasses: string[];
}

/**
 * Comprehensive metadata extracted from the page.
 */
export interface PageMetadata {
  /** Basic page information */
  title: string;
  url: string;
  domain: string;
  /** Schema.org structured data (JSON-LD format) */
  jsonLd: SchemaOrgData[];
  /** Schema.org microdata items */
  microdata: Array<{
    type: string | null;
    properties: Record<string, string>;
  }>;
  /** OpenGraph protocol data */
  openGraph: OpenGraphData;
  /** Twitter Card data */
  twitterCard: TwitterCardData;
  /** Standard HTML meta tags */
  meta: StandardMetaTags;
  /** Publisher information extracted from various sources */
  publisher: {
    name?: string;
    logo?: string;
    url?: string;
    twitter?: string;
    copyright?: string;
  };
  /** Site categorization signals */
  categorization: SiteCategorizationData;
  /** E-commerce specific signals */
  ecommerce: {
    hasProducts: boolean;
    productCount?: number;
    currency?: string;
    priceRange?: {
      min?: number;
      max?: number;
    };
  };
  /** Site type indicators */
  indicators: {
    hasProducts: boolean;
    hasArticles: boolean;
    hasEvents: boolean;
    hasJobs: boolean;
    hasRecipes: boolean;
    hasRealEstate: boolean;
    platform?: string;
    cmsType?: string;
  };
  /** Inferred site type based on all signals */
  siteType?: 'e-commerce' | 'news' | 'blog' | 'corporate' | 'job-board' | 'real-estate' | 'recipe' | 'forum' | 'social' | 'unknown';
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
  /**
   * Comprehensive metadata extracted from the page including Schema.org,
   * OpenGraph, and other structured data.
   */
  metadata?: PageMetadata;
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
