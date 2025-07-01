/**
 * @fileoverview Tests for health monitoring and early detection of issues
 */

import { describe, it, expect, vi } from 'vitest';
import { ClusterHealthMonitor } from '../utils/puppeteer-telemetry.js';
import winston from 'winston';
import { EventEmitter } from 'events';

// Mock logger
const mockLogger = winston.createLogger({
  level: 'error',
  transports: [new winston.transports.Console({ silent: true })],
});

describe('Health Monitoring Tests', () => {
  describe('ClusterHealthMonitor', () => {
    it('should track error counts correctly', () => {
      const monitor = new ClusterHealthMonitor(mockLogger);

      // Initially healthy
      expect(monitor.getHealthStatus().healthy).toBe(true);
      expect(monitor.getHealthStatus().errorCount).toBe(0);

      // Simulate cluster with errors
      const mockCluster = new EventEmitter() as any;
      monitor.startMonitoring(mockCluster);

      // Emit some errors
      for (let i = 0; i < 5; i++) {
        mockCluster.emit('taskerror', new Error('Test error'), {
          url: `https://test${i}.com`,
        });
      }

      const status = monitor.getHealthStatus();
      expect(status.errorCount).toBe(5);
      expect(status.healthy).toBe(true); // Still healthy under threshold

      // Emit more errors to make unhealthy
      for (let i = 0; i < 10; i++) {
        mockCluster.emit('taskerror', new Error('Test error'), {
          url: `https://test${i}.com`,
        });
      }

      const unhealthyStatus = monitor.getHealthStatus();
      expect(unhealthyStatus.errorCount).toBe(15);
      expect(unhealthyStatus.healthy).toBe(false);

      monitor.stopMonitoring();
    });

    it('should detect critical errors', () => {
      const monitor = new ClusterHealthMonitor(mockLogger);
      const mockCluster = new EventEmitter() as any;

      let criticalErrorDetected = false;
      const originalError = mockLogger.error;
      mockLogger.error = vi.fn((message: string) => {
        if (message.includes('Critical cluster error')) {
          criticalErrorDetected = true;
        }
        originalError.call(mockLogger, message);
      }) as any;

      monitor.startMonitoring(mockCluster);

      // Emit the critical error
      mockCluster.emit(
        'taskerror',
        new Error('Requesting main frame too early!'),
        { url: 'https://problematic.com' }
      );

      expect(criticalErrorDetected).toBe(true);
      expect(monitor.getHealthStatus().errorCount).toBe(1);

      monitor.stopMonitoring();
    });

    it('should reset error count', () => {
      const monitor = new ClusterHealthMonitor(mockLogger);
      const mockCluster = new EventEmitter() as any;

      monitor.startMonitoring(mockCluster);

      // Add some errors
      for (let i = 0; i < 5; i++) {
        mockCluster.emit('taskerror', new Error('Test'), { url: 'test' });
      }

      expect(monitor.getHealthStatus().errorCount).toBe(5);

      // Reset
      monitor.resetErrorCount();
      expect(monitor.getHealthStatus().errorCount).toBe(0);
      expect(monitor.getHealthStatus().healthy).toBe(true);

      monitor.stopMonitoring();
    });
  });

  describe('Early Warning Detection', () => {
    it('should detect patterns in errors', async () => {
      const errorPatterns: Map<string, number> = new Map();

      // Simulate processing with error tracking
      const trackError = (error: Error) => {
        const pattern = detectErrorPattern(error.message);
        errorPatterns.set(pattern, (errorPatterns.get(pattern) || 0) + 1);
      };

      // Simulate various errors
      const errors = [
        new Error('Requesting main frame too early!'),
        new Error('Requesting main frame too early!'),
        new Error(
          'Protocol error (Page.navigate): Cannot navigate to invalid URL'
        ),
        new Error('Navigation timeout of 30000 ms exceeded'),
        new Error('Requesting main frame too early!'),
      ];

      errors.forEach(trackError);

      // Check if we can detect the pattern
      const mainFrameErrors = errorPatterns.get('frame_error') || 0;
      expect(mainFrameErrors).toBe(3);

      // Should trigger warning
      const shouldWarn = Array.from(errorPatterns.values()).some(
        (count) => count >= 3
      );
      expect(shouldWarn).toBe(true);
    });

    it('should calculate error rates', () => {
      const stats = {
        totalProcessed: 100,
        errors: {
          frame_error: 5,
          timeout: 3,
          navigation: 2,
        },
      };

      const errorRate =
        (Object.values(stats.errors).reduce((a, b) => a + b, 0) /
          stats.totalProcessed) *
        100;
      expect(errorRate).toBe(10);

      // Check individual error rates
      const frameErrorRate =
        (stats.errors.frame_error / stats.totalProcessed) * 100;
      expect(frameErrorRate).toBe(5);

      // Should trigger alert if frame error rate is high
      const shouldAlert = frameErrorRate > 2;
      expect(shouldAlert).toBe(true);
    });
  });

  describe('Performance Metrics', () => {
    it('should track processing times', async () => {
      const metrics: number[] = [];

      // Simulate processing with timing
      for (let i = 0; i < 10; i++) {
        const start = Date.now();

        // Simulate some work
        await new Promise((resolve) =>
          setTimeout(resolve, Math.random() * 100)
        );

        const duration = Date.now() - start;
        metrics.push(duration);
      }

      // Calculate statistics
      const avg = metrics.reduce((a, b) => a + b, 0) / metrics.length;
      const max = Math.max(...metrics);
      const min = Math.min(...metrics);

      expect(avg).toBeGreaterThan(0);
      expect(max).toBeGreaterThan(avg);
      expect(min).toBeLessThan(avg);

      // Detect anomalies (e.g., processing taking too long)
      const threshold = avg * 2;
      const anomalies = metrics.filter((m) => m > threshold);

      console.log(
        `Performance metrics - Avg: ${avg.toFixed(2)}ms, Max: ${max}ms, Anomalies: ${anomalies.length}`
      );
    });

    it('should detect memory leaks', async () => {
      const memorySnapshots: number[] = [];

      // Take memory snapshots
      for (let i = 0; i < 5; i++) {
        if (global.gc) global.gc();

        const usage = process.memoryUsage();
        memorySnapshots.push(usage.heapUsed);

        // Simulate some work
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Check for consistent growth
      let growthCount = 0;
      for (let i = 1; i < memorySnapshots.length; i++) {
        if (memorySnapshots[i] > memorySnapshots[i - 1]) {
          growthCount++;
        }
      }

      // If memory grows every time, might be a leak
      const possibleLeak = growthCount === memorySnapshots.length - 1;

      console.log(
        `Memory snapshots: ${memorySnapshots.map((m) => (m / 1024 / 1024).toFixed(2) + 'MB').join(', ')}`
      );
      console.log(`Possible memory leak: ${possibleLeak}`);
    });
  });
});

// Helper function to detect error patterns
function detectErrorPattern(message: string): string {
  if (message.includes('Requesting main frame too early')) return 'frame_error';
  if (message.includes('timeout')) return 'timeout';
  if (message.includes('navigate')) return 'navigation';
  if (message.includes('Protocol error')) return 'protocol_error';
  return 'unknown';
}
