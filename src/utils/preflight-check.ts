import { batchValidateDNS } from './dns-validator.js';
import { batchValidateSSL } from './ssl-validator.js';
import { DomainHealthTracker } from './error-recovery.js';
import type { Logger as WinstonLogger } from 'winston';

export interface PreflightResult {
  url: string;
  passedDNS: boolean;
  passedSSL: boolean;
  predictedToFail: boolean;
  skipReason?: string;
  warnings?: string[];
}

export interface PreflightOptions {
  checkDNS?: boolean;
  checkSSL?: boolean;
  checkHealth?: boolean;
  dnsConcurrency?: number;
  sslConcurrency?: number;
}

/**
 * Performs pre-flight checks on URLs to avoid processing dead/invalid sites
 */
export class PreflightChecker {
  constructor(
    private healthTracker: DomainHealthTracker,
    private logger?: WinstonLogger
  ) {}
  
  async checkUrls(
    urls: string[],
    options: PreflightOptions = {}
  ): Promise<Map<string, PreflightResult>> {
    const {
      checkDNS = true,
      checkSSL = true,
      checkHealth = true,
      dnsConcurrency = 50,
      sslConcurrency = 10
    } = options;
    
    const results = new Map<string, PreflightResult>();
    
    // Initialize results
    urls.forEach(url => {
      results.set(url, {
        url,
        passedDNS: true,
        passedSSL: true,
        predictedToFail: false
      });
    });
    
    // Step 1: DNS validation
    if (checkDNS) {
      this.logger?.info('Starting DNS pre-flight checks...');
      const dnsResults = await batchValidateDNS(urls, this.logger, dnsConcurrency);
      
      for (const [url, dnsResult] of dnsResults) {
        const result = results.get(url)!;
        result.passedDNS = dnsResult.valid;
        
        if (!dnsResult.valid) {
          result.skipReason = `DNS lookup failed: ${dnsResult.error}`;
        }
      }
    }
    
    // Step 2: SSL validation (only for URLs that passed DNS)
    if (checkSSL) {
      const urlsForSSL = urls.filter(url => results.get(url)!.passedDNS);
      
      if (urlsForSSL.length > 0) {
        this.logger?.info(`Starting SSL pre-flight checks for ${urlsForSSL.length} URLs...`);
        const sslResults = await batchValidateSSL(urlsForSSL, this.logger, sslConcurrency);
        
        for (const [url, sslResult] of sslResults) {
          const result = results.get(url)!;
          result.passedSSL = sslResult.valid;
          
          if (!sslResult.valid) {
            result.skipReason = result.skipReason || `SSL validation failed: ${sslResult.error}`;
            result.warnings = result.warnings || [];
            
            // Add specific warnings for common SSL issues
            if (sslResult.error?.includes('CERT_HAS_EXPIRED')) {
              result.warnings.push('Certificate expired');
            } else if (sslResult.error?.includes('UNABLE_TO_VERIFY_LEAF_SIGNATURE')) {
              result.warnings.push('Invalid certificate chain');
            }
          }
        }
      }
    }
    
    // Step 3: Domain health prediction
    if (checkHealth) {
      for (const url of urls) {
        const result = results.get(url)!;
        
        // Only check health if basic checks passed
        if (result.passedDNS && result.passedSSL) {
          result.predictedToFail = this.healthTracker.isLikelyToFail(url);
          
          if (result.predictedToFail) {
            const health = this.healthTracker.getDomainHealth(url);
            if (health?.lastError) {
              result.warnings = result.warnings || [];
              result.warnings.push(`Previous failures: ${health.failureCount}, Last error: ${health.lastError.code}`);
            }
          }
        }
      }
    }
    
    // Log summary
    const passed = Array.from(results.values()).filter(
      r => r.passedDNS && r.passedSSL && !r.predictedToFail
    ).length;
    const failedDNS = Array.from(results.values()).filter(r => !r.passedDNS).length;
    const failedSSL = Array.from(results.values()).filter(r => !r.passedSSL).length;
    const predicted = Array.from(results.values()).filter(r => r.predictedToFail).length;
    
    this.logger?.info(`Pre-flight check summary: ${passed}/${urls.length} passed`);
    this.logger?.info(`  DNS failures: ${failedDNS}`);
    this.logger?.info(`  SSL failures: ${failedSSL}`);
    this.logger?.info(`  Predicted failures: ${predicted}`);
    
    return results;
  }
  
  /**
   * Filters URLs based on pre-flight results
   */
  filterUrls(
    urls: string[],
    preflightResults: Map<string, PreflightResult>
  ): {
    processable: string[];
    skipped: string[];
    warnings: string[];
  } {
    const processable: string[] = [];
    const skipped: string[] = [];
    const warnings: string[] = [];
    
    for (const url of urls) {
      const result = preflightResults.get(url);
      
      if (!result) {
        processable.push(url);
        continue;
      }
      
      if (!result.passedDNS || !result.passedSSL) {
        skipped.push(url);
      } else if (result.predictedToFail) {
        // Still process but with warnings
        processable.push(url);
        warnings.push(url);
      } else {
        processable.push(url);
      }
    }
    
    return { processable, skipped, warnings };
  }
}