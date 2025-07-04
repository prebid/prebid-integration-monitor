import * as https from 'https';
import * as tls from 'tls';
import type { Logger as WinstonLogger } from 'winston';

export interface SSLValidationResult {
  url: string;
  valid: boolean;
  error?: string;
  certificateDetails?: {
    issuer?: string;
    validFrom?: Date;
    validTo?: Date;
    expired?: boolean;
  };
}

/**
 * Pre-validates SSL certificates to avoid browser errors
 * @param url - URL to validate
 * @param timeout - Timeout in milliseconds
 * @returns SSL validation result
 */
export async function validateSSL(
  url: string,
  timeout: number = 5000
): Promise<SSLValidationResult> {
  return new Promise((resolve) => {
    try {
      const { hostname, port, protocol } = new URL(url);
      
      // Only check HTTPS URLs
      if (protocol !== 'https:') {
        resolve({ url, valid: true });
        return;
      }
      
      const checkPort = port ? parseInt(port) : 443;
      
      const socket = tls.connect(
        checkPort,
        hostname,
        { 
          servername: hostname,
          timeout,
          rejectUnauthorized: true
        },
        () => {
          const cert = socket.getPeerCertificate();
          
          if (socket.authorized) {
            resolve({
              url,
              valid: true,
              certificateDetails: {
                issuer: cert.issuer?.O,
                validFrom: new Date(cert.valid_from),
                validTo: new Date(cert.valid_to),
                expired: new Date() > new Date(cert.valid_to)
              }
            });
          } else {
            resolve({
              url,
              valid: false,
              error: socket.authorizationError?.message || socket.authorizationError?.toString() || 'CERTIFICATE_INVALID'
            });
          }
          
          socket.end();
        }
      );
      
      socket.on('error', (error) => {
        resolve({
          url,
          valid: false,
          error: error.message || 'SSL_CONNECTION_ERROR'
        });
      });
      
      socket.on('timeout', () => {
        socket.destroy();
        resolve({
          url,
          valid: false,
          error: 'SSL_CONNECTION_TIMEOUT'
        });
      });
      
    } catch (error) {
      resolve({
        url,
        valid: false,
        error: 'SSL_CHECK_FAILED'
      });
    }
  });
}

/**
 * Batch validates SSL certificates
 */
export async function batchValidateSSL(
  urls: string[],
  logger?: WinstonLogger,
  concurrency: number = 10
): Promise<Map<string, SSLValidationResult>> {
  const results = new Map<string, SSLValidationResult>();
  
  // Process in smaller chunks for SSL to avoid connection limits
  for (let i = 0; i < urls.length; i += concurrency) {
    const chunk = urls.slice(i, i + concurrency);
    const chunkResults = await Promise.all(
      chunk.map(url => validateSSL(url))
    );
    
    chunkResults.forEach(result => {
      results.set(result.url, result);
    });
    
    if (logger && i % 100 === 0) {
      logger.debug(`SSL validation progress: ${i + chunk.length}/${urls.length}`);
    }
  }
  
  const validCount = Array.from(results.values()).filter(r => r.valid).length;
  if (logger) {
    logger.info(`SSL validation complete: ${validCount} valid out of ${urls.length} URLs`);
  }
  
  return results;
}