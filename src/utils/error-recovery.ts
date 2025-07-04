import { DetailedError, ErrorCategory } from './error-types.js';
import type { Logger as WinstonLogger } from 'winston';

export interface RetryStrategy {
  shouldRetry: boolean;
  delay: number;
  maxAttempts: number;
  backoffMultiplier?: number;
}

export interface DomainHealth {
  domain: string;
  lastError?: DetailedError;
  failureCount: number;
  successCount: number;
  lastSuccess?: Date;
  lastFailure?: Date;
  avgResponseTime?: number;
}

/**
 * Determines retry strategy based on error type
 */
export function getRetryStrategy(error: DetailedError): RetryStrategy {
  // Never retry permanent failures
  const permanentErrors = [
    'DNS_RESOLUTION_FAILED',
    'INVALID_CERTIFICATE_AUTHORITY',
    'CERTIFICATE_EXPIRED',
    'CERTIFICATE_NAME_MISMATCH',
    'PAGE_NOT_FOUND',
    'ACCESS_FORBIDDEN',
    'IP_BLOCKED'
  ];
  
  if (permanentErrors.includes(error.code)) {
    return { shouldRetry: false, delay: 0, maxAttempts: 0 };
  }
  
  // Quick retry for temporary network issues
  const temporaryNetworkErrors = [
    'CONNECTION_TIMEOUT',
    'NETWORK_CHANGED',
    'NAVIGATION_TIMEOUT'
  ];
  
  if (temporaryNetworkErrors.includes(error.code)) {
    return { 
      shouldRetry: true, 
      delay: 2000, 
      maxAttempts: 2,
      backoffMultiplier: 2
    };
  }
  
  // Slow retry for rate limits and protection
  const rateLimitErrors = [
    'RATE_LIMITED',
    'CDN_PROTECTION',
    'CAPTCHA_REQUIRED'
  ];
  
  if (rateLimitErrors.includes(error.code)) {
    return { 
      shouldRetry: true, 
      delay: 30000, 
      maxAttempts: 1,
      backoffMultiplier: 1
    };
  }
  
  // Browser/context errors - retry with new context
  const browserErrors = [
    'BROWSER_SESSION_CLOSED',
    'CONTEXT_DESTROYED',
    'FRAME_DETACHED',
    'BROWSER_CRASHED'
  ];
  
  if (browserErrors.includes(error.code)) {
    return { 
      shouldRetry: true, 
      delay: 1000, 
      maxAttempts: 1,
      backoffMultiplier: 1
    };
  }
  
  // Default: no retry
  return { shouldRetry: false, delay: 0, maxAttempts: 0 };
}

/**
 * Tracks domain health to predict failures
 */
export class DomainHealthTracker {
  private healthMap = new Map<string, DomainHealth>();
  
  constructor(private logger?: WinstonLogger) {}
  
  recordSuccess(url: string, responseTime: number): void {
    const domain = new URL(url).hostname;
    const health = this.healthMap.get(domain) || {
      domain,
      failureCount: 0,
      successCount: 0
    };
    
    health.successCount++;
    health.lastSuccess = new Date();
    
    // Update average response time
    if (health.avgResponseTime) {
      health.avgResponseTime = (health.avgResponseTime + responseTime) / 2;
    } else {
      health.avgResponseTime = responseTime;
    }
    
    this.healthMap.set(domain, health);
  }
  
  recordFailure(url: string, error: DetailedError): void {
    const domain = new URL(url).hostname;
    const health = this.healthMap.get(domain) || {
      domain,
      failureCount: 0,
      successCount: 0
    };
    
    health.failureCount++;
    health.lastError = error;
    health.lastFailure = new Date();
    
    this.healthMap.set(domain, health);
  }
  
  getDomainHealth(url: string): DomainHealth | undefined {
    const domain = new URL(url).hostname;
    return this.healthMap.get(domain);
  }
  
  /**
   * Predicts if a URL is likely to fail based on domain history
   */
  isLikelyToFail(url: string): boolean {
    const health = this.getDomainHealth(url);
    if (!health) return false;
    
    // If last 3 attempts failed, likely to fail again
    if (health.failureCount >= 3 && !health.lastSuccess) {
      return true;
    }
    
    // If failure rate > 80%
    const totalAttempts = health.failureCount + health.successCount;
    if (totalAttempts > 5 && health.failureCount / totalAttempts > 0.8) {
      return true;
    }
    
    // If last error was permanent
    if (health.lastError) {
      const strategy = getRetryStrategy(health.lastError);
      if (!strategy.shouldRetry) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Groups URLs by expected processing difficulty
   */
  prioritizeUrls(urls: string[]): {
    healthy: string[];
    risky: string[];
    failing: string[];
  } {
    const healthy: string[] = [];
    const risky: string[] = [];
    const failing: string[] = [];
    
    for (const url of urls) {
      const health = this.getDomainHealth(url);
      
      if (!health) {
        // Unknown domains are healthy
        healthy.push(url);
      } else if (health.failureCount === 0) {
        healthy.push(url);
      } else if (this.isLikelyToFail(url)) {
        failing.push(url);
      } else {
        risky.push(url);
      }
    }
    
    this.logger?.info(`URL prioritization: ${healthy.length} healthy, ${risky.length} risky, ${failing.length} failing`);
    
    return { healthy, risky, failing };
  }
  
  /**
   * Gets recommended concurrency based on domain health
   */
  getRecommendedConcurrency(url: string, baseConcurrency: number): number {
    const health = this.getDomainHealth(url);
    if (!health) return baseConcurrency;
    
    // Reduce concurrency for problematic domains
    if (health.failureCount > 0) {
      return Math.max(1, Math.floor(baseConcurrency / 2));
    }
    
    // Slow domains get lower concurrency
    if (health.avgResponseTime && health.avgResponseTime > 30000) {
      return Math.max(2, Math.floor(baseConcurrency / 3));
    }
    
    return baseConcurrency;
  }
}