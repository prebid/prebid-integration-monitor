// src/config/app-config.ts
/**
 * Default User-Agent string for Puppeteer page requests.
 * Matches the actual Chrome version bundled with Puppeteer for authenticity.
 * Updated to macOS platform for better consistency.
 */
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

/**
 * Alternative user agent strings for different platforms
 */
export const USER_AGENT_STRINGS = {
  macos:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  linux:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
} as const;

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
export const DEFAULT_RESOURCES_TO_BLOCK: Set<ResourceType> =
  new Set<ResourceType>([
    'image',
    'font',
    'media',
    'texttrack',
    'eventsource',
    'manifest',
    'other',
  ]);

/**
 * Enhanced Puppeteer launch arguments for better stability and compatibility
 */
export const ENHANCED_PUPPETEER_ARGS = [
  // Basic security and sandbox
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',

  // Performance and stability
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-features=TranslateUI',
  '--disable-ipc-flooding-protection',

  // Security and privacy
  '--disable-client-side-phishing-detection',
  '--disable-default-apps',
  '--disable-hang-monitor',
  '--disable-popup-blocking',
  '--disable-prompt-on-repost',
  '--disable-sync',
  '--disable-web-security',

  // Media and notifications
  '--disable-notifications',
  '--disable-permissions-api',
  '--disable-geolocation',
  '--disable-speech-api',
  '--disable-device-discovery-notifications',

  // Memory and resource management
  '--memory-pressure-off',
  '--max_old_space_size=4096',
  '--disable-background-networking',

  // Graphics and rendering (for headless compatibility)
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--disable-canvas-aa',
  '--disable-2d-canvas-clip-aa',
  '--disable-gl-drawing-for-tests',

  // Network and certificates
  '--ignore-certificate-errors',
  '--ignore-ssl-errors',
  '--ignore-certificate-errors-spki-list',
  '--ignore-certificate-errors-policy',
  '--disable-extensions-except',
  '--disable-extensions',

  // User experience
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-infobars',
  '--disable-session-crashed-bubble',
  '--disable-restore-session-state',

  // Additional stability flags
  '--disable-blink-features=AutomationControlled',
  '--disable-features=VizDisplayCompositor',
] as const;

/**
 * Timeout configurations for different types of operations
 */
export const TIMEOUTS = {
  DNS_LOOKUP: 5000, // ms
  NAVIGATION_FIRST_ATTEMPT: 60000, // ms
  NAVIGATION_RETRY: 30000, // ms
  POPUP_DISMISSAL: 2000, // ms
  DYNAMIC_CONTENT_LOADING: 5000, // ms
  PAGE_INTERACTION: 1000, // ms
} as const;

// Add other configurations as identified
