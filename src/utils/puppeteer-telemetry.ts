/**
 * @fileoverview OpenTelemetry instrumentation for Puppeteer page lifecycle
 * Provides detailed tracing to diagnose "Requesting main frame too early" errors
 */

import {
  trace,
  Tracer,
  Span,
  SpanStatusCode,
  context,
} from '@opentelemetry/api';
import type { Page, Browser } from 'puppeteer';
import type { Cluster } from 'puppeteer-cluster';
import type { Logger as WinstonLogger } from 'winston';

const TRACER_NAME = 'puppeteer-lifecycle';

/**
 * Get or create the Puppeteer tracer
 */
export function getPuppeteerTracer(): Tracer {
  return trace.getTracer(TRACER_NAME, '1.0.0');
}

/**
 * Page lifecycle event tracker
 */
export class PageLifecycleTracer {
  private tracer: Tracer;
  private pageSpan?: Span;
  private url: string;
  private logger: WinstonLogger;
  private events: Array<{ event: string; timestamp: number; error?: string }> =
    [];

  constructor(url: string, logger: WinstonLogger) {
    this.tracer = getPuppeteerTracer();
    this.url = url;
    this.logger = logger;
  }

  /**
   * Start tracking page lifecycle
   */
  startPageProcessing(): Span {
    this.pageSpan = this.tracer.startSpan('page.process', {
      attributes: {
        'page.url': this.url,
        'page.start_time': new Date().toISOString(),
      },
    });
    this.recordEvent('page_processing_started');
    return this.pageSpan;
  }

  /**
   * Record a lifecycle event
   */
  recordEvent(event: string, error?: Error) {
    const timestamp = Date.now();
    this.events.push({ event, timestamp, error: error?.message });

    if (this.pageSpan) {
      this.pageSpan.addEvent(event, {
        'event.timestamp': timestamp,
        'event.error': error?.message || undefined,
        'event.stack': error?.stack || undefined,
      });
    }

    if (error) {
      // Only log critical errors, not all lifecycle events
      if (
        event === 'page_processing_failed' ||
        event === 'critical_main_frame_error' ||
        (error.message &&
          error.message.includes('Requesting main frame too early'))
      ) {
        this.logger.debug(`Page lifecycle error at ${event}:`, {
          url: this.url,
          event,
          error: error.message,
          stack: error.stack,
          allEvents: this.events,
        });
      }
    }
  }

  /**
   * Setup page event handlers for comprehensive tracking
   */
  setupPageEventHandlers(page: Page): void {
    // Track frame lifecycle
    page.on('frameattached', () => this.recordEvent('frame_attached'));
    page.on('framedetached', () => this.recordEvent('frame_detached'));
    page.on('framenavigated', (frame) => {
      this.recordEvent('frame_navigated', undefined);
      this.pageSpan?.setAttribute('frame.url', frame.url());
    });

    // Track page lifecycle
    page.on('load', () => this.recordEvent('page_load'));
    page.on('domcontentloaded', () => this.recordEvent('dom_content_loaded'));
    page.on('close', () => this.recordEvent('page_close'));
    page.on('crash', () => this.recordEvent('page_crash'));

    // Track errors
    page.on('error', (error) => {
      this.recordEvent('page_error', error);
      if (error.message.includes('Requesting main frame too early')) {
        this.logger.debug('Main frame lifecycle error detected', {
          url: this.url,
          error: error.message,
          lifecycle_events: this.events,
        });
      }
    });

    page.on('pageerror', (error) => this.recordEvent('page_js_error', error));

    // Track navigation
    page.on('request', (request) => {
      if (request.isNavigationRequest()) {
        this.recordEvent('navigation_request', undefined);
        this.pageSpan?.setAttribute('navigation.url', request.url());
      }
    });

    page.on('requestfailed', (request) => {
      if (request.isNavigationRequest()) {
        this.recordEvent(
          'navigation_failed',
          new Error(request.failure()?.errorText || 'Unknown')
        );
      }
    });

    // Track console messages for debugging
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        this.recordEvent('console_error', new Error(msg.text()));
      }
    });
  }

  /**
   * Finish tracking with success
   */
  finish(success: boolean, data?: any): void {
    if (this.pageSpan) {
      this.pageSpan.setStatus({
        code: success ? SpanStatusCode.OK : SpanStatusCode.ERROR,
        message: success
          ? 'Page processed successfully'
          : 'Page processing failed',
      });

      if (data) {
        this.pageSpan.setAttribute(
          'page.has_prebid',
          !!data.prebidInstances?.length
        );
        this.pageSpan.setAttribute(
          'page.has_libraries',
          !!data.libraries?.length
        );
      }

      this.pageSpan.setAttribute('page.total_events', this.events.length);
      this.pageSpan.setAttribute(
        'page.duration_ms',
        Date.now() - (this.events[0]?.timestamp || Date.now())
      );

      this.pageSpan.end();
    }

    this.logger.debug('Page lifecycle completed', {
      url: this.url,
      success,
      eventCount: this.events.length,
      events: this.events,
    });
  }

  /**
   * Finish tracking with error
   */
  finishWithError(error: Error): void {
    this.recordEvent('page_processing_failed', error);

    if (this.pageSpan) {
      this.pageSpan.recordException(error);
      this.pageSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
      this.pageSpan.end();
    }
  }
}

/**
 * Cluster health monitor
 */
export class ClusterHealthMonitor {
  private tracer: Tracer;
  private logger: WinstonLogger;
  private healthCheckInterval?: NodeJS.Timeout;
  private errorCount: number = 0;
  private lastError?: Error;
  private cluster?: Cluster<any, any>;

  constructor(logger: WinstonLogger) {
    this.tracer = getPuppeteerTracer();
    this.logger = logger;
  }

  /**
   * Start monitoring cluster health
   */
  startMonitoring(cluster: Cluster<any, any>): void {
    this.cluster = cluster;
    this.errorCount = 0;

    // Monitor cluster events
    cluster.on('taskerror', (err, data) => {
      this.errorCount++;
      this.lastError = err;

      const span = this.tracer.startSpan('cluster.task_error');
      span.recordException(err);
      span.setAttribute('error.url', data.url);
      span.setAttribute('error.count', this.errorCount);

      if (err.message.includes('Requesting main frame too early')) {
        span.setAttribute('error.critical', true);
        this.logger.error('Critical cluster error - main frame issue', {
          url: data.url,
          error: err.message,
          errorCount: this.errorCount,
        });
      }

      span.end();
    });

    // Health check every 30 seconds
    this.healthCheckInterval = setInterval(() => {
      const span = this.tracer.startSpan('cluster.health_check');

      try {
        const isHealthy = this.checkClusterHealth();
        span.setAttribute('cluster.healthy', isHealthy);
        span.setAttribute('cluster.error_count', this.errorCount);

        if (!isHealthy) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: 'Cluster unhealthy',
          });
          this.logger.warn('Cluster health check failed', {
            errorCount: this.errorCount,
            lastError: this.lastError?.message,
          });
        }
      } finally {
        span.end();
      }
    }, 30000);
  }

  /**
   * Check if cluster is healthy
   */
  private checkClusterHealth(): boolean {
    // Consider unhealthy if more than 10 errors in recent history
    if (this.errorCount > 10) {
      return false;
    }

    // Check if cluster is still responsive
    if (this.cluster && (this.cluster as any).isClosed?.()) {
      return false;
    }

    return true;
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
  }

  /**
   * Reset error count (call after successful batch)
   */
  resetErrorCount(): void {
    this.errorCount = 0;
    this.lastError = undefined;
  }

  /**
   * Get current health status
   */
  getHealthStatus(): {
    healthy: boolean;
    errorCount: number;
    lastError?: string;
  } {
    return {
      healthy: this.checkClusterHealth(),
      errorCount: this.errorCount,
      lastError: this.lastError?.message,
    };
  }
}

/**
 * Wrap a page processing function with telemetry
 */
export function withPageTelemetry<T>(
  url: string,
  logger: WinstonLogger,
  processFn: (page: Page, tracker: PageLifecycleTracer) => Promise<T>
): (page: Page) => Promise<T> {
  return async (page: Page) => {
    const tracker = new PageLifecycleTracer(url, logger);
    const span = tracker.startPageProcessing();

    return context.with(trace.setSpan(context.active(), span), async () => {
      try {
        tracker.setupPageEventHandlers(page);
        const result = await processFn(page, tracker);
        tracker.finish(true, result);
        return result;
      } catch (error) {
        tracker.finishWithError(error as Error);
        throw error;
      }
    });
  };
}
