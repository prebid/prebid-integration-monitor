// src/config/app-config.ts
/**
 * Default User-Agent string for Puppeteer page requests.
 * Mimics a common desktop Chrome browser.
 */
export const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Default timeout for Puppeteer page operations (e.g., `page.goto`, `page.waitForSelector`).
 * Value is in milliseconds.
 */
export const PUPPETEER_DEFAULT_PAGE_TIMEOUT = 55000; // ms

/**
 * Timeout for Puppeteer's underlying DevTools Protocol communication.
 * Increased to allow for longer-running operations or slower networks.
 * Value is in milliseconds.
 */
export const PUPPETEER_PROTOCOL_TIMEOUT = 1000000; // ms

/**
 * Maximum time to wait for `pbjs.version` to become available on a page
 * during Prebid.js version detection polling.
 * Value is in milliseconds.
 */
export const PBJS_VERSION_WAIT_TIMEOUT_MS = 15000; // ms

/**
 * Interval at which to check for `pbjs.version` on a page
 * during Prebid.js version detection polling.
 * Value is in milliseconds.
 */
export const PBJS_VERSION_WAIT_INTERVAL_MS = 100; // ms

/**
 * Defines the types of resources that Puppeteer can block.
 * Used in conjunction with `DEFAULT_RESOURCES_TO_BLOCK`.
 */
export type ResourceType =
| 'image'
| 'font'
| 'websocket'
| 'media'
| 'texttrack'
| 'eventsource'
| 'manifest'
| 'other'
| 'stylesheet'
| 'script'
| 'xhr';

/**
 * A Set of `ResourceType`s that are blocked by default in Puppeteer.
 * This helps to speed up page loads and reduce noise during scans by
 * preventing non-essential resources from being loaded.
 */
export const DEFAULT_RESOURCES_TO_BLOCK: Set<ResourceType> = new Set<ResourceType>([
  'image',
  'font',
  'media',
  'texttrack',
  'eventsource',
  'manifest',
  'other',
]);

// Add other configurations as identified
