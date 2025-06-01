import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ConsoleSpanExporter, BatchSpanProcessor } from '@opentelemetry/sdk-trace-node'; // Added ConsoleSpanExporter and BatchSpanProcessor
import { Resource } from '@opentelemetry/resources'; // Reverted to original import
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

let sdk: NodeSDK; // Define sdk in a broader scope

export const initTracer = () => {
  const otlpExporter = new OTLPTraceExporter({ // Renamed to otlpExporter for clarity
    // optional - default url is http://localhost:4318/v1/traces
    // You can use environment variables to configure the endpoint, e.g.,
    // url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
  });

  const consoleExporter = new ConsoleSpanExporter();

  sdk = new NodeSDK({
    // traceExporter: otlpExporter, // Can use multiple exporters or switch as needed
    spanProcessors: [new BatchSpanProcessor(consoleExporter), new BatchSpanProcessor(otlpExporter)], // Added ConsoleSpanExporter via BatchSpanExporter
    instrumentations: [getNodeAutoInstrumentations()],
    // resource: new Resource({
    //   [SemanticResourceAttributes.SERVICE_NAME]: 'prebid-integration-monitor',
    // }),
  });
  console.log('DEBUG: NodeSDK initialized with OTLPTraceExporter and Instrumentations (Resource commented out). Calling sdk.start().');

  sdk.start(); // Re-enabled sdk.start()
};

process.on('SIGTERM', () => {
  if (sdk) {
    sdk.shutdown()
      .then(() => console.log('Tracing terminated'))
      .catch((error) => console.error('Error terminating tracing', error))
      .finally(() => process.exit(0));
  } else {
    process.exit(0);
  }
});
