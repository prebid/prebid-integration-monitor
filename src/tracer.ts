/**
 * @file Initializes and manages OpenTelemetry tracing for the application.
 * This module sets up the OpenTelemetry NodeSDK with appropriate exporters
 * (OTLP and Console) and automatic instrumentations to enable distributed tracing.
 *
 * @remarks
 * The OTLP exporter's behavior (e.g., endpoint, headers, protocol) is typically configured
 * through OpenTelemetry standard environment variables:
 * - `OTEL_EXPORTER_OTLP_ENDPOINT`: The target URL for the OTLP collector (e.g., `http://localhost:4318/v1/traces`).
 * - `OTEL_EXPORTER_OTLP_HEADERS`: Headers for the OTLP exporter (e.g., `api-key=YOUR_API_KEY`).
 * - `OTEL_EXPORTER_OTLP_PROTOCOL`: The protocol to use (`http/protobuf` or `grpc`).
 *
 * Service-identifying attributes (like service name, version) can be configured by setting:
 * - `OTEL_SERVICE_NAME`
 * - `OTEL_SERVICE_VERSION`
 * - `OTEL_DEPLOYMENT_ENVIRONMENT`
 * If these are not set, the SDK might use default, less descriptive values. The commented-out
 * `_createServiceResource` function provides an example of how to set these programmatically if needed.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  ConsoleSpanExporter,
  BatchSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import loggerModule from './utils/logger.js';
const logger = loggerModule.instance;
// Resource and SemanticResourceAttributes would be needed if _createServiceResource is used.
// import { Resource } from '@opentelemetry/resources';
// import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

// Example of a helper function to create a Resource object with service details.
// const _createServiceResource = (): Resource => {
//   const serviceName = process.env.OTEL_SERVICE_NAME || 'prebid-explorer';
//   const serviceVersion = process.env.OTEL_SERVICE_VERSION || 'unknown';
//   const deploymentEnvironment = process.env.OTEL_DEPLOYMENT_ENVIRONMENT || 'development';
//   return new Resource({
//     [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
//     [SemanticResourceAttributes.SERVICE_VERSION]: serviceVersion,
//     [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: deploymentEnvironment,
//   });
// };

/**
 * Holds the OpenTelemetry NodeSDK instance once initialized.
 * This allows the SDK to be accessed globally within this module, for example, by the SIGTERM handler.
 * @type {NodeSDK | undefined}
 */
let sdk: NodeSDK | undefined;

/**
 * Initializes the OpenTelemetry SDK for tracing.
 *
 * This function configures and starts the OpenTelemetry NodeSDK. It sets up two primary span exporters:
 * 1.  **OTLPTraceExporter**: Sends trace data to an OpenTelemetry collector, typically over HTTP/protobuf or gRPC.
 *     Its configuration (endpoint, headers, protocol) is primarily managed via standard OpenTelemetry
 *     environment variables (e.g., `OTEL_EXPORTER_OTLP_ENDPOINT`).
 * 2.  **ConsoleSpanExporter**: Prints trace data directly to the console. This is highly useful for local
 *     development and debugging purposes, providing immediate visibility into traces.
 *
 * The SDK is also enhanced with automatic instrumentations for many common Node.js libraries through
 * `getNodeAutoInstrumentations()`. This feature automatically traces operations for libraries like HTTP clients,
 * web frameworks (e.g., Express), and database clients (e.g., pg, mysql) without requiring manual
 * instrumentation code for each.
 *
 * **Resource Configuration Note**: While this setup initializes tracing, for more effective telemetry
 * analysis in observability platforms, it's crucial to define a `Resource`. A Resource includes attributes
 * that identify your service (e.g., `service.name`, `service.version`). The OpenTelemetry SDK creates a default
 * Resource if one isn't provided, but it's often minimal. The commented-out `_createServiceResource` function
 * demonstrates how to create a customized Resource, which can then be passed to the `NodeSDK` constructor
 * (e.g., `new NodeSDK({ resource: _createServiceResource(), ... })`).
 *
 * After configuration, `sdk.start()` is called, activating tracing for the application.
 * Errors during initialization are logged, and the application may continue without tracing if an error occurs.
 */
export const initTracer = () => {
  try {
    const otlpExporter = new OTLPTraceExporter({
      // Default OTLP exporter configuration.
      // For production, ensure environment variables like OTEL_EXPORTER_OTLP_ENDPOINT are set.
      // e.g., 'http://localhost:4318/v1/traces' for OTLP/HTTP
      // e.g., 'api-key=YOUR_API_KEY' for OTEL_EXPORTER_OTLP_HEADERS
    });

    const consoleExporter = new ConsoleSpanExporter(); // For local debugging visibility.

    sdk = new NodeSDK({
      // To explicitly define a resource: resource: _createServiceResource(),
      // BatchSpanProcessor is recommended for production to improve performance
      // by sending spans in batches rather than individually.
      spanProcessors: [
        new BatchSpanProcessor(consoleExporter), // Logs to console
        new BatchSpanProcessor(otlpExporter), // Exports to OTLP endpoint
      ],
      // Automatically instruments supported Node.js libraries.
      instrumentations: [getNodeAutoInstrumentations()],
    });

    logger.info(
      'OpenTelemetry NodeSDK initialized with OTLP and Console exporters. Auto-instrumentations are enabled. Attempting to start SDK...'
    );
    sdk.start(); // Activates the SDK.
    logger.info('OpenTelemetry NodeSDK started successfully.');
  } catch (error) {
    // Logs initialization errors. The application might continue without tracing.
    logger.error('Failed to initialize or start OpenTelemetry SDK:', { error });
    // Consider re-throwing for critical failures: throw error;
    // Or log a specific warning: logger.warn('Application will continue without OpenTelemetry tracing enabled.');
  }
};

/**
 * Handles the SIGTERM signal for graceful shutdown of the OpenTelemetry SDK.
 *
 * When the application receives a SIGTERM signal (common in containerized environments
 * or when a process manager stops the application), this handler is invoked.
 * It attempts to shut down the OpenTelemetry SDK using `sdk.shutdown()`.
 * This is a critical step to ensure that any buffered telemetry data (spans)
 * is flushed to the configured exporters before the process exits, preventing data loss.
 * The process will exit after attempting shutdown, regardless of success or failure.
 */
process.on('SIGTERM', () => {
  if (sdk) {
    sdk
      .shutdown()
      .then(() => logger.info('OpenTelemetry tracing terminated gracefully.'))
      .catch((error) =>
        logger.error('Error shutting down OpenTelemetry tracing', { error })
      )
      .finally(() => process.exit(0));
  } else {
    // If SDK was never initialized, exit directly.
    process.exit(0);
  }
});
