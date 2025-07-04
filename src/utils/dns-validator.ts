import * as dns from 'dns';
import { promisify } from 'util';
import type { Logger as WinstonLogger } from 'winston';

const lookup = promisify(dns.lookup);

export interface DNSValidationResult {
  url: string;
  hostname: string;
  valid: boolean;
  error?: string;
}

/**
 * Pre-validates DNS for a batch of URLs to avoid browser launch for dead domains
 * @param urls - Array of URLs to validate
 * @param logger - Winston logger instance
 * @param concurrency - Number of concurrent DNS lookups
 * @returns Map of URL to validation result
 */
export async function batchValidateDNS(
  urls: string[],
  logger?: WinstonLogger,
  concurrency: number = 50
): Promise<Map<string, DNSValidationResult>> {
  const results = new Map<string, DNSValidationResult>();
  
  // Process in chunks to avoid overwhelming DNS resolver
  for (let i = 0; i < urls.length; i += concurrency) {
    const chunk = urls.slice(i, i + concurrency);
    const chunkResults = await Promise.all(
      chunk.map(async (url) => {
        try {
          const hostname = new URL(url).hostname;
          const startTime = Date.now();
          
          await lookup(hostname);
          
          const result: DNSValidationResult = {
            url,
            hostname,
            valid: true
          };
          
          results.set(url, result);
          return result;
        } catch (error) {
          const result: DNSValidationResult = {
            url,
            hostname: new URL(url).hostname,
            valid: false,
            error: (error as any).code || 'DNS_LOOKUP_FAILED'
          };
          
          results.set(url, result);
          return result;
        }
      })
    );
    
    if (logger && i % 500 === 0) {
      logger.debug(`DNS validation progress: ${i + chunk.length}/${urls.length}`);
    }
  }
  
  // Log summary
  const validCount = Array.from(results.values()).filter(r => r.valid).length;
  const invalidCount = results.size - validCount;
  
  if (logger) {
    logger.info(`DNS validation complete: ${validCount} valid, ${invalidCount} invalid out of ${urls.length} URLs`);
  }
  
  return results;
}

/**
 * Quick DNS check for a single URL
 */
export async function validateDNS(url: string): Promise<boolean> {
  try {
    const hostname = new URL(url).hostname;
    await lookup(hostname);
    return true;
  } catch {
    return false;
  }
}