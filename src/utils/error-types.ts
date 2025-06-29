export enum ErrorCategory {
  NETWORK = 'network',
  TIMEOUT = 'timeout',
  CONTENT = 'content',
  EXTRACTION = 'extraction',
  BROWSER = 'browser',
  ACCESS = 'access',
  SSL = 'ssl',
  UNKNOWN = 'unknown'
}

export enum ProcessingPhase {
  INITIALIZATION = 'initialization',
  NAVIGATION = 'navigation',
  PAGE_LOAD = 'page_load',
  INTERACTION = 'interaction',
  DATA_EXTRACTION = 'data_extraction',
  CLEANUP = 'cleanup'
}

export interface DetailedError {
  category: ErrorCategory;
  subCategory: string;
  phase: ProcessingPhase;
  code: string;
  message: string;
  originalError?: string;
  retryAttempt?: number;
  partialData?: any;
  url: string;
  timestamp: string;
  stack?: string;
  metadata?: Record<string, any>;
}

export interface ErrorDetectionRule {
  pattern: RegExp | string;
  category: ErrorCategory;
  subCategory: string;
  code: string;
  extractMetadata?: (error: Error) => Record<string, any>;
}

export const ERROR_DETECTION_RULES: ErrorDetectionRule[] = [
  // Network Errors
  {
    pattern: /net::ERR_NAME_NOT_RESOLVED/,
    category: ErrorCategory.NETWORK,
    subCategory: 'dns',
    code: 'DNS_RESOLUTION_FAILED'
  },
  {
    pattern: /net::ERR_CONNECTION_REFUSED/,
    category: ErrorCategory.NETWORK,
    subCategory: 'connection',
    code: 'CONNECTION_REFUSED'
  },
  {
    pattern: /net::ERR_CONNECTION_TIMED_OUT/,
    category: ErrorCategory.NETWORK,
    subCategory: 'connection',
    code: 'CONNECTION_TIMEOUT'
  },
  {
    pattern: /net::ERR_NETWORK_CHANGED/,
    category: ErrorCategory.NETWORK,
    subCategory: 'connection',
    code: 'NETWORK_CHANGED'
  },
  {
    pattern: /net::ERR_INTERNET_DISCONNECTED/,
    category: ErrorCategory.NETWORK,
    subCategory: 'connection',
    code: 'NO_INTERNET'
  },
  {
    pattern: /net::ERR_ADDRESS_UNREACHABLE/,
    category: ErrorCategory.NETWORK,
    subCategory: 'routing',
    code: 'ADDRESS_UNREACHABLE'
  },
  
  // SSL/Certificate Errors
  {
    pattern: /net::ERR_CERT_AUTHORITY_INVALID/,
    category: ErrorCategory.SSL,
    subCategory: 'certificate',
    code: 'INVALID_CERTIFICATE_AUTHORITY'
  },
  {
    pattern: /net::ERR_CERT_DATE_INVALID/,
    category: ErrorCategory.SSL,
    subCategory: 'certificate',
    code: 'CERTIFICATE_EXPIRED'
  },
  {
    pattern: /net::ERR_SSL_PROTOCOL_ERROR/,
    category: ErrorCategory.SSL,
    subCategory: 'protocol',
    code: 'SSL_PROTOCOL_ERROR'
  },
  {
    pattern: /net::ERR_CERT_COMMON_NAME_INVALID/,
    category: ErrorCategory.SSL,
    subCategory: 'certificate',
    code: 'CERTIFICATE_NAME_MISMATCH'
  },
  
  // Timeout Errors
  {
    pattern: /Navigation timeout of \d+ ms exceeded/,
    category: ErrorCategory.TIMEOUT,
    subCategory: 'navigation',
    code: 'NAVIGATION_TIMEOUT',
    extractMetadata: (error) => {
      const match = error.message.match(/Navigation timeout of (\d+) ms/);
      return { timeoutMs: match ? parseInt(match[1]) : null };
    }
  },
  {
    pattern: /Timeout \d+ms exceeded/,
    category: ErrorCategory.TIMEOUT,
    subCategory: 'operation',
    code: 'OPERATION_TIMEOUT',
    extractMetadata: (error) => {
      const match = error.message.match(/Timeout (\d+)ms/);
      return { timeoutMs: match ? parseInt(match[1]) : null };
    }
  },
  {
    pattern: /waiting for selector .* timed out/i,
    category: ErrorCategory.TIMEOUT,
    subCategory: 'element',
    code: 'ELEMENT_WAIT_TIMEOUT',
    extractMetadata: (error) => {
      const match = error.message.match(/waiting for selector ["'](.*)["']/i);
      return { selector: match ? match[1] : null };
    }
  },
  
  // Browser/Puppeteer Errors
  {
    pattern: /Session closed|Target closed/,
    category: ErrorCategory.BROWSER,
    subCategory: 'session',
    code: 'BROWSER_SESSION_CLOSED'
  },
  {
    pattern: /Protocol error/,
    category: ErrorCategory.BROWSER,
    subCategory: 'protocol',
    code: 'BROWSER_PROTOCOL_ERROR'
  },
  {
    pattern: /Execution context was destroyed/,
    category: ErrorCategory.BROWSER,
    subCategory: 'context',
    code: 'CONTEXT_DESTROYED'
  },
  {
    pattern: /detached Frame/,
    category: ErrorCategory.BROWSER,
    subCategory: 'frame',
    code: 'FRAME_DETACHED'
  },
  {
    pattern: /Target crashed/,
    category: ErrorCategory.BROWSER,
    subCategory: 'crash',
    code: 'BROWSER_CRASHED'
  },
  
  // Content Errors
  {
    pattern: /Page appears to be unavailable or redirected to error page/,
    category: ErrorCategory.CONTENT,
    subCategory: 'availability',
    code: 'PAGE_UNAVAILABLE',
    extractMetadata: (error) => {
      const match = error.message.match(/\(([^)]+)\)$/);
      return { pageTitle: match ? match[1] : null };
    }
  },
  {
    pattern: /404|not found/i,
    category: ErrorCategory.CONTENT,
    subCategory: 'http_error',
    code: 'PAGE_NOT_FOUND'
  },
  {
    pattern: /403|forbidden/i,
    category: ErrorCategory.ACCESS,
    subCategory: 'http_error',
    code: 'ACCESS_FORBIDDEN'
  },
  {
    pattern: /401|unauthorized/i,
    category: ErrorCategory.ACCESS,
    subCategory: 'http_error',
    code: 'UNAUTHORIZED'
  },
  {
    pattern: /500|internal server error/i,
    category: ErrorCategory.CONTENT,
    subCategory: 'http_error',
    code: 'SERVER_ERROR'
  },
  {
    pattern: /503|service unavailable/i,
    category: ErrorCategory.CONTENT,
    subCategory: 'http_error',
    code: 'SERVICE_UNAVAILABLE'
  },
  
  // Access Control Errors
  {
    pattern: /captcha|recaptcha/i,
    category: ErrorCategory.ACCESS,
    subCategory: 'bot_detection',
    code: 'CAPTCHA_REQUIRED'
  },
  {
    pattern: /rate limit|too many requests/i,
    category: ErrorCategory.ACCESS,
    subCategory: 'rate_limit',
    code: 'RATE_LIMITED'
  },
  {
    pattern: /blocked|banned|blacklisted/i,
    category: ErrorCategory.ACCESS,
    subCategory: 'blocked',
    code: 'IP_BLOCKED'
  },
  {
    pattern: /cloudflare|cf-ray/i,
    category: ErrorCategory.ACCESS,
    subCategory: 'cdn_protection',
    code: 'CDN_PROTECTION'
  },
  
  // JavaScript/Extraction Errors
  {
    pattern: /Evaluation failed|Execution context/,
    category: ErrorCategory.EXTRACTION,
    subCategory: 'javascript',
    code: 'JS_EVALUATION_FAILED'
  },
  {
    pattern: /Cannot read prop/,
    category: ErrorCategory.EXTRACTION,
    subCategory: 'javascript',
    code: 'JS_PROPERTY_ERROR'
  },
  {
    pattern: /undefined is not/,
    category: ErrorCategory.EXTRACTION,
    subCategory: 'javascript',
    code: 'JS_UNDEFINED_ERROR'
  }
];

export function detectErrorType(error: Error, phase: ProcessingPhase, url: string, retryAttempt?: number): DetailedError {
  const errorMessage = error.message || '';
  const errorStack = error.stack || '';
  const fullErrorText = `${errorMessage} ${errorStack}`;
  
  // Try to match against known patterns
  for (const rule of ERROR_DETECTION_RULES) {
    const pattern = typeof rule.pattern === 'string' ? new RegExp(rule.pattern, 'i') : rule.pattern;
    if (pattern.test(fullErrorText)) {
      const metadata = rule.extractMetadata ? rule.extractMetadata(error) : {};
      
      return {
        category: rule.category,
        subCategory: rule.subCategory,
        phase,
        code: rule.code,
        message: errorMessage,
        originalError: error.toString(),
        retryAttempt,
        url,
        timestamp: new Date().toISOString(),
        stack: errorStack,
        metadata
      };
    }
  }
  
  // Fallback for unknown errors
  return {
    category: ErrorCategory.UNKNOWN,
    subCategory: 'unclassified',
    phase,
    code: 'UNKNOWN_ERROR',
    message: errorMessage,
    originalError: error.toString(),
    retryAttempt,
    url,
    timestamp: new Date().toISOString(),
    stack: errorStack
  };
}

export function formatDetailedError(error: DetailedError): string {
  const parts = [
    `[${error.timestamp}]`,
    `Category: ${error.category}/${error.subCategory}`,
    `Phase: ${error.phase}`,
    `Code: ${error.code}`,
    `URL: ${error.url}`,
    `Message: ${error.message}`
  ];
  
  if (error.retryAttempt !== undefined) {
    parts.push(`Retry: ${error.retryAttempt}`);
  }
  
  if (error.metadata && Object.keys(error.metadata).length > 0) {
    parts.push(`Metadata: ${JSON.stringify(error.metadata)}`);
  }
  
  return parts.join(' | ');
}

export function categorizeErrorForFile(error: DetailedError): string {
  // Determine which error file this should go to
  const fileMapping: Record<string, string[]> = {
    'navigation_errors.txt': [
      'DNS_RESOLUTION_FAILED',
      'CONNECTION_REFUSED',
      'CONNECTION_TIMEOUT',
      'ADDRESS_UNREACHABLE',
      'NO_INTERNET',
      'NETWORK_CHANGED'
    ],
    'ssl_errors.txt': [
      'INVALID_CERTIFICATE_AUTHORITY',
      'CERTIFICATE_EXPIRED',
      'SSL_PROTOCOL_ERROR',
      'CERTIFICATE_NAME_MISMATCH'
    ],
    'timeout_errors.txt': [
      'NAVIGATION_TIMEOUT',
      'OPERATION_TIMEOUT',
      'ELEMENT_WAIT_TIMEOUT'
    ],
    'access_errors.txt': [
      'ACCESS_FORBIDDEN',
      'UNAUTHORIZED',
      'CAPTCHA_REQUIRED',
      'RATE_LIMITED',
      'IP_BLOCKED',
      'CDN_PROTECTION'
    ],
    'content_errors.txt': [
      'PAGE_UNAVAILABLE',
      'PAGE_NOT_FOUND',
      'SERVER_ERROR',
      'SERVICE_UNAVAILABLE'
    ],
    'browser_errors.txt': [
      'BROWSER_SESSION_CLOSED',
      'BROWSER_PROTOCOL_ERROR',
      'CONTEXT_DESTROYED',
      'FRAME_DETACHED',
      'BROWSER_CRASHED'
    ],
    'extraction_errors.txt': [
      'JS_EVALUATION_FAILED',
      'JS_PROPERTY_ERROR',
      'JS_UNDEFINED_ERROR'
    ]
  };
  
  for (const [filename, codes] of Object.entries(fileMapping)) {
    if (codes.includes(error.code)) {
      return filename;
    }
  }
  
  // Default fallback
  return 'error_processing.txt';
}