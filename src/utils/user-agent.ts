/**
 * @fileoverview User agent generation utilities for creating authentic browser signatures.
 * Provides dynamic user agent generation that matches the actual Chrome version
 * bundled with Puppeteer for maximum authenticity and reduced bot detection.
 */

import puppeteer from 'puppeteer';
import type { Logger as WinstonLogger } from 'winston';

/**
 * Supported platforms for user agent generation
 */
export type Platform = 'macos' | 'windows' | 'linux' | 'auto';

/**
 * User agent configuration options
 */
export interface UserAgentConfig {
  /** Platform to generate user agent for. 'auto' detects current platform */
  platform?: Platform;
  /** Custom Chrome version override */
  chromeVersion?: string;
  /** Whether to use the exact Puppeteer version */
  usePuppeteerVersion?: boolean;
}

/**
 * Cached Chrome version to avoid repeated browser launches
 */
let cachedChromeVersion: string | null = null;

/**
 * Gets the Chrome version from Puppeteer by launching a browser instance
 * @param logger Optional logger for debugging
 * @returns Chrome version string (e.g., "127.0.6533.88")
 */
export async function getPuppeteerChromeVersion(
  logger?: WinstonLogger
): Promise<string> {
  if (cachedChromeVersion) {
    return cachedChromeVersion;
  }

  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const version = await browser.version();
    await browser.close();

    // Extract version number from "Chrome/127.0.6533.88" format
    const versionMatch = version.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/);
    if (versionMatch) {
      cachedChromeVersion = versionMatch[1];
      logger?.debug(
        `Detected Puppeteer Chrome version: ${cachedChromeVersion}`
      );
      return cachedChromeVersion;
    }

    throw new Error(`Could not parse Chrome version from: ${version}`);
  } catch (error) {
    const fallbackVersion = '127.0.0.0';
    logger?.warn(
      `Failed to detect Chrome version, using fallback: ${fallbackVersion}`,
      { error }
    );
    cachedChromeVersion = fallbackVersion;
    return fallbackVersion;
  }
}

/**
 * Detects the current platform
 * @returns Platform identifier
 */
export function detectPlatform(): Exclude<Platform, 'auto'> {
  switch (process.platform) {
    case 'darwin':
      return 'macos';
    case 'win32':
      return 'windows';
    case 'linux':
      return 'linux';
    default:
      return 'linux'; // Default fallback
  }
}

/**
 * Generates an authentic user agent string for the specified platform and Chrome version
 * @param platform Target platform
 * @param chromeVersion Chrome version string
 * @returns Complete user agent string
 */
export function generateUserAgent(
  platform: Exclude<Platform, 'auto'>,
  chromeVersion: string
): string {
  const baseWebKit = '537.36';

  const platformStrings = {
    macos: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/${baseWebKit} (KHTML, like Gecko) Chrome/${chromeVersion} Safari/${baseWebKit}`,
    windows: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/${baseWebKit} (KHTML, like Gecko) Chrome/${chromeVersion} Safari/${baseWebKit}`,
    linux: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/${baseWebKit} (KHTML, like Gecko) Chrome/${chromeVersion} Safari/${baseWebKit}`,
  };

  return platformStrings[platform];
}

/**
 * Creates an authentic user agent that matches the current Puppeteer installation
 * @param config Configuration options
 * @param logger Optional logger for debugging
 * @returns Promise resolving to user agent string
 */
export async function createAuthenticUserAgent(
  config: UserAgentConfig = {},
  logger?: WinstonLogger
): Promise<string> {
  const {
    platform = 'auto',
    chromeVersion,
    usePuppeteerVersion = true,
  } = config;

  // Determine platform
  const targetPlatform = platform === 'auto' ? detectPlatform() : platform;

  // Determine Chrome version
  let targetChromeVersion: string;
  if (chromeVersion) {
    targetChromeVersion = chromeVersion;
    logger?.debug(`Using custom Chrome version: ${targetChromeVersion}`);
  } else if (usePuppeteerVersion) {
    targetChromeVersion = await getPuppeteerChromeVersion(logger);
    logger?.debug(`Using Puppeteer Chrome version: ${targetChromeVersion}`);
  } else {
    targetChromeVersion = '127.0.0.0'; // Fallback
    logger?.debug(`Using fallback Chrome version: ${targetChromeVersion}`);
  }

  const userAgent = generateUserAgent(targetPlatform, targetChromeVersion);
  logger?.info(`Generated user agent for ${targetPlatform}: ${userAgent}`);

  return userAgent;
}

/**
 * Validates a user agent string for basic authenticity
 * @param userAgent User agent string to validate
 * @returns Validation result with issues
 */
export function validateUserAgent(userAgent: string): {
  isValid: boolean;
  issues: string[];
  info: { platform?: string; chromeVersion?: string };
} {
  const issues: string[] = [];
  const info: { platform?: string; chromeVersion?: string } = {};

  // Check basic structure
  if (!userAgent.includes('Mozilla/5.0')) {
    issues.push('Missing Mozilla/5.0 prefix');
  }

  if (!userAgent.includes('AppleWebKit')) {
    issues.push('Missing AppleWebKit identifier');
  }

  if (!userAgent.includes('Chrome/')) {
    issues.push('Missing Chrome identifier');
  }

  if (!userAgent.includes('Safari/')) {
    issues.push('Missing Safari suffix');
  }

  // Extract platform
  if (userAgent.includes('Macintosh')) {
    info.platform = 'macOS';
  } else if (userAgent.includes('Windows')) {
    info.platform = 'Windows';
  } else if (userAgent.includes('Linux')) {
    info.platform = 'Linux';
  }

  // Extract Chrome version
  const chromeMatch = userAgent.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/);
  if (chromeMatch) {
    info.chromeVersion = chromeMatch[1];

    // Check if version is recent (not too old)
    const majorVersion = parseInt(chromeMatch[1].split('.')[0]);
    if (majorVersion < 120) {
      issues.push(
        `Chrome version ${info.chromeVersion} may be too old for authenticity`
      );
    }
  } else {
    issues.push('Could not parse Chrome version');
  }

  // Check for suspicious patterns
  if (
    userAgent.toLowerCase().includes('bot') ||
    userAgent.toLowerCase().includes('crawler')
  ) {
    issues.push('Contains bot/crawler indicators');
  }

  return {
    isValid: issues.length === 0,
    issues,
    info,
  };
}

/**
 * Gets multiple user agent options for different platforms using current Chrome version
 * @param logger Optional logger
 * @returns Promise resolving to user agent options
 */
export async function getUserAgentOptions(logger?: WinstonLogger): Promise<{
  current: string;
  options: Record<Exclude<Platform, 'auto'>, string>;
  chromeVersion: string;
}> {
  const chromeVersion = await getPuppeteerChromeVersion(logger);
  const currentPlatform = detectPlatform();

  const options = {
    macos: generateUserAgent('macos', chromeVersion),
    windows: generateUserAgent('windows', chromeVersion),
    linux: generateUserAgent('linux', chromeVersion),
  };

  return {
    current: options[currentPlatform],
    options,
    chromeVersion,
  };
}
