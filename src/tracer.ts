/**
 * @file Initializes and manages OpenTelemetry tracing for the application.
 * This module sets up the OpenTelemetry NodeSDK with appropriate exporters
 * and instrumentations to enable distributed tracing.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  ConsoleSpanExporter,
  BatchSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
// Resource identifies the entity producing telemetry (e.g., a service).
// It's recommended to configure it with attributes like service name, version, environment, etc.
// Example: new Resource({ [SemanticResourceAttributes.SERVICE_NAME]: 'your-service-name', [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0' })
// Using named import for the TYPE, and require for the VALUE due to persistent TS2693 error.
// import type { Resource as OpenTelemetryResourceType } from '@opentelemetry/resources';
// import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

// const OpenTelemetryResourceValue = require('@opentelemetry/resources').Resource;

/**
 * Creates a Resource instance for the service.
 * This helper function centralizes the logic for defining service-identifying attributes.
 * It reads service name, version, and environment from environment variables if available,
 * providing sensible defaults otherwise.
 *
 * Environment variables:
 * - OTEL_SERVICE_NAME: The name of the service.
 * - OTEL_SERVICE_VERSION: The version of the service.
 * - OTEL_DEPLOYMENT_ENVIRONMENT: The deployment environment (e.g., 'production', 'staging').
 *
 * @returns {OpenTelemetryResourceType} The configured Resource object.
 */
// const _createServiceResource = (): OpenTelemetryResourceType => {
//   // Type annotation uses the imported OpenTelemetryResourceType
//   const serviceName = process.env.OTEL_SERVICE_NAME || 'unknown_service';
//   const serviceVersion = process.env.OTEL_SERVICE_VERSION || '0.0.0';
//   const deploymentEnvironment =
//     process.env.OTEL_DEPLOYMENT_ENVIRONMENT || 'unknown';

//   return new (OpenTelemetryResourceValue as new (
//     attributes: Record<string, any>,
//   ) => OpenTelemetryResourceType)({
//     // Use the required value as constructor
//     [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
//     [SemanticResourceAttributes.SERVICE_VERSION]: serviceVersion,
//     [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: deploymentEnvironment,
//     // Add any other common resource attributes here
//   });
// };

/**
 * Holds the OpenTelemetry NodeSDK instance once initialized.
 * @type {NodeSDK | undefined}
 */
let sdk: NodeSDK | undefined;

/**
 * Initializes the OpenTelemetry SDK for tracing.
 *
 * This function configures and starts the OpenTelemetry NodeSDK. It sets up
 * two span exporters:
 * 1. OTLPTraceExporter: Sends trace data to an OpenTelemetry collector (typically via HTTP/gRPC).
 *    The OTLPTraceExporter is configured here with default settings. It generally relies on
 *    environment variables for full configuration (e.g., OTEL_EXPORTER_OTLP_ENDPOINT,
 *    OTEL_EXPORTER_OTLP_HEADERS, OTEL_EXPORTER_OTLP_PROTOCOL).
 * 2. ConsoleSpanExporter: Prints trace data to the console, which is useful for local
 *    development and debugging.
 *
 * The SDK is also configured with automatic instrumentations for many popular Node.js
 * libraries via `getNodeAutoInstrumentations()`. This means common operations like HTTP requests,
 * database queries, etc., will be automatically traced without manual setup.
 *
 * Note: The `Resource` for the SDK is not explicitly configured in this function by default.
 * While OpenTelemetry SDKs typically create a default Resource, this default may contain
 * minimal information (e.g., telemetry.sdk.language, telemetry.sdk.name, telemetry.sdk.version).
 * For effective telemetry analysis, filtering, and aggregation in observability backends,
 * explicitly create and configure a `Resource` object with attributes like
 * `SERVICE_NAME`, `SERVICE_VERSION`, and ideally `DEPLOYMENT_ENVIRONMENT`.
 * A helper function `_createServiceResource` is available below to facilitate this.
 * e.g. `new NodeSDK({ resource: _createServiceResource(), ... })`
 *
 * After configuration, this function starts the SDK, making tracing active for the application.
 */
export const initTracer = () => {
  try {
    const otlpExporter = new OTLPTraceExporter({
      // Default configuration. For production, ensure OTLP endpoint and headers are configured,
      // often via environment variables like:
      // OTEL_EXPORTER_OTLP_ENDPOINT (e.g., 'http://localhost:4318/v1/traces' for OTLP/HTTP, or 'http://localhost:4317' for OTLP/gRPC)
      // OTEL_EXPORTER_OTLP_HEADERS (e.g., 'api-key=YOUR_API_KEY,another-header=value')
      // OTEL_EXPORTER_OTLP_PROTOCOL (e.g., 'http/protobuf' or 'grpc')
    });

    const consoleExporter = new ConsoleSpanExporter();

    // const resource = _createServiceResource(); // Call the helper if you uncomment resource below

    sdk = new NodeSDK({
      // To explicitly define a resource for your service, uncomment and use the helper function:
      // resource: _createServiceResource(), // or resource: resource if defined above
      // This helper reads OTEL_SERVICE_NAME, OTEL_SERVICE_VERSION, and OTEL_DEPLOYMENT_ENVIRONMENT
      // from environment variables or uses defaults. See its JSDoc for more details.
      // BatchSpanProcessor improves performance by collecting spans in batches before sending
      // them to the exporter. This reduces the overhead of exporting each span individually
      // and is generally recommended for production.
      // Advanced configuration options include scheduledDelayMillis, maxQueueSize, maxExportBatchSize etc.
      // See OpenTelemetry documentation for more details on BatchSpanProcessor configuration.
      spanProcessors: [
        new BatchSpanProcessor(consoleExporter), // For local debugging
        new BatchSpanProcessor(otlpExporter), // For production export
      ],
      // Enables a suite of automatic instrumentations for common Node.js libraries
      // (e.g., HTTP, Express, gRPC, various DB clients like pg, mysql).
      // This can be configured to disable specific instrumentations or to pass options to them.
      // For example, to disable http instrumentation: getNodeAutoInstrumentations({'@opentelemetry/instrumentation-http': {enabled: false}})
      // See OpenTelemetry documentation for details on customizing auto-instrumentations.
      instrumentations: [getNodeAutoInstrumentations()],
    });

    console.log(
      'OpenTelemetry NodeSDK initialized with OTLP and Console exporters. Auto-instrumentations are enabled. Attempting to start SDK...',
    );
    sdk.start();
    console.log('OpenTelemetry NodeSDK started successfully.');
  } catch (error) {
    console.error('Failed to initialize or start OpenTelemetry SDK:', error);
    // Depending on the application's criticality of tracing, you might choose to:
    // 1. Re-throw the error to halt application startup if tracing is essential:
    //    throw error;
    // 2. Allow the application to continue without tracing (as is the current behavior):
    //    console.warn('Application will continue without OpenTelemetry tracing enabled.');
    // Note: If sdk.start() fails, the sdk instance might exist but tracing will not be active.
    // The SIGTERM handler will still attempt shutdown if sdk is defined.
  }
};

/**
 * Handles the SIGTERM signal to ensure graceful shutdown of the OpenTelemetry SDK.
 *
 * When a SIGTERM signal is received (e.g., during application termination by an orchestrator),
 * this handler attempts to shut down the OpenTelemetry SDK. This is crucial for
 * ensuring that any buffered telemetry data is flushed to the configured exporters
 * before the process exits, preventing data loss.
 */
process.on('SIGTERM', () => {
  if (sdk) {
    sdk
      .shutdown()
      .then(() => console.log('Tracing terminated gracefully'))
      .catch((error) => console.error('Error shutting down tracing', error))
      .finally(() => process.exit(0));
  } else {
    // If SDK was not initialized, exit directly.
    process.exit(0);
  }
});
