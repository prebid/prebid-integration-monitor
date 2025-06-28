/**
 * @fileoverview Domain validation utilities for pre-filtering URLs before expensive Puppeteer operations.
 * Helps identify and skip invalid domains, DNS failures, and known problematic patterns.
 */

import dns from 'dns';
import { promisify } from 'util';
import type { Logger as WinstonLogger } from 'winston';

const dnsLookup = promisify(dns.lookup);

/**
 * Result of domain validation
 */
export interface DomainValidationResult {
  isValid: boolean;
  reason?: string;
  domain: string;
}

/**
 * Known patterns that indicate problematic domains
 */
const PROBLEMATIC_PATTERNS = [
  // Obvious testing/placeholder domains
  /^test\./,
  /^example\./,
  /^localhost/,
  /^127\./,
  /^192\.168\./,
  /^10\./,
  
  // Common typos or malformed domains
  /\.\./,
  /^\.|\.$/, 
  /[^a-zA-Z0-9.-]/,
  
  // Suspicious TLDs that are often typos
  /\.c$/,
  /\.co\.$/,
  /\.htm$/,
  /\.html$/,
  
  // Known parking/advertising domains
  /parked-content/,
  /domain-for-sale/,
  /sedo\.com/,
  /bodis\.com/,
];

/**
 * Extracts the domain from a URL
 * @param url The URL to extract domain from
 * @returns The domain part of the URL
 */
export function extractDomain(url: string): string {
  try {
    // Handle URLs without protocol
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch (error) {
    // If URL parsing fails, try to extract domain manually
    const match = url.match(/^(?:https?:\/\/)?([^\/]+)/);
    return match ? match[1] : url;
  }
}

/**
 * Validates a domain using pattern matching (fast, no network calls)
 * @param domain The domain to validate
 * @returns Validation result
 */
export function validateDomainPattern(domain: string): DomainValidationResult {
  // Check for empty or null domain
  if (!domain || domain.trim().length === 0) {
    return {
      isValid: false,
      reason: 'Empty domain',
      domain
    };
  }

  const cleanDomain = domain.trim().toLowerCase();

  // Check against problematic patterns
  for (const pattern of PROBLEMATIC_PATTERNS) {
    if (pattern.test(cleanDomain)) {
      return {
        isValid: false,
        reason: `Matches problematic pattern: ${pattern.source}`,
        domain: cleanDomain
      };
    }
  }

  // Basic domain format validation
  if (cleanDomain.length > 255) {
    return {
      isValid: false,
      reason: 'Domain too long',
      domain: cleanDomain
    };
  }

  // Check for valid domain structure
  const domainParts = cleanDomain.split('.');
  if (domainParts.length < 2) {
    return {
      isValid: false,
      reason: 'Invalid domain structure',
      domain: cleanDomain
    };
  }

  // Check each part
  for (const part of domainParts) {
    if (part.length === 0 || part.length > 63) {
      return {
        isValid: false,
        reason: 'Invalid domain part length',
        domain: cleanDomain
      };
    }
  }

  return {
    isValid: true,
    domain: cleanDomain
  };
}

/**
 * Validates a domain using DNS lookup (network call - slower but more accurate)
 * @param domain The domain to validate
 * @param logger Optional logger for debugging
 * @param timeoutMs Timeout for DNS lookup in milliseconds
 * @returns Promise resolving to validation result
 */
export async function validateDomainDNS(
  domain: string, 
  logger?: WinstonLogger,
  timeoutMs: number = 5000
): Promise<DomainValidationResult> {
  // First do pattern validation
  const patternResult = validateDomainPattern(domain);
  if (!patternResult.isValid) {
    return patternResult;
  }

  try {
    // Perform DNS lookup with timeout
    const lookupPromise = dnsLookup(domain);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('DNS lookup timeout')), timeoutMs);
    });

    await Promise.race([lookupPromise, timeoutPromise]);
    
    logger?.debug(`DNS validation passed for ${domain}`);
    return {
      isValid: true,
      domain
    };
    
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'DNS lookup failed';
    logger?.debug(`DNS validation failed for ${domain}: ${reason}`);
    
    return {
      isValid: false,
      reason: `DNS lookup failed: ${reason}`,
      domain
    };
  }
}

/**
 * Batch validates multiple domains concurrently
 * @param domains Array of domains to validate
 * @param logger Optional logger for debugging
 * @param concurrency Maximum concurrent DNS lookups
 * @param includeDNS Whether to include DNS validation (slower but more accurate)
 * @returns Promise resolving to array of validation results
 */
export async function validateDomainsBatch(
  domains: string[],
  logger?: WinstonLogger,
  concurrency: number = 10,
  includeDNS: boolean = false
): Promise<DomainValidationResult[]> {
  logger?.info(`Validating ${domains.length} domains (DNS: ${includeDNS}, concurrency: ${concurrency})`);

  if (!includeDNS) {
    // Fast pattern-only validation
    return domains.map(domain => validateDomainPattern(extractDomain(domain)));
  }

  // DNS validation with concurrency control
  const results: DomainValidationResult[] = [];
  
  for (let i = 0; i < domains.length; i += concurrency) {
    const batch = domains.slice(i, i + concurrency);
    const batchPromises = batch.map(async (domain) => {
      const extractedDomain = extractDomain(domain);
      return await validateDomainDNS(extractedDomain, logger);
    });

    const batchResults = await Promise.allSettled(batchPromises);
    
    batchResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        // Handle rejected promise
        const domain = extractDomain(batch[index]);
        results.push({
          isValid: false,
          reason: 'Validation error: ' + result.reason,
          domain
        });
      }
    });

    // Log progress for large batches
    if (domains.length > 100) {
      logger?.debug(`Validated ${Math.min(i + concurrency, domains.length)}/${domains.length} domains`);
    }
  }

  const validCount = results.filter(r => r.isValid).length;
  logger?.info(`Domain validation complete: ${validCount}/${domains.length} valid domains`);

  return results;
}

/**
 * Filters a list of URLs to only include those with valid domains
 * @param urls Array of URLs to filter
 * @param logger Optional logger for debugging
 * @param includeDNS Whether to include DNS validation
 * @param concurrency Maximum concurrent validations
 * @returns Promise resolving to filtered array of valid URLs
 */
export async function filterValidUrls(
  urls: string[],
  logger?: WinstonLogger,
  includeDNS: boolean = false,
  concurrency: number = 10
): Promise<string[]> {
  const validationResults = await validateDomainsBatch(urls, logger, concurrency, includeDNS);
  
  const validUrls = urls.filter((_, index) => validationResults[index].isValid);
  const invalidCount = urls.length - validUrls.length;
  
  if (invalidCount > 0) {
    logger?.info(`Filtered out ${invalidCount} invalid URLs, ${validUrls.length} remaining`);
    
    // Log some examples of filtered URLs for debugging
    const invalidResults = validationResults
      .filter(r => !r.isValid)
      .slice(0, 5);
    
    if (invalidResults.length > 0) {
      logger?.debug('Example invalid domains:', invalidResults.map(r => `${r.domain}: ${r.reason}`));
    }
  }
  
  return validUrls;
}