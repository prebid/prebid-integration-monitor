import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
let sdk; // Define sdk in a broader scope
export const initTracer = () => {
    const traceExporter = new OTLPTraceExporter({
    // optional - default url is http://localhost:4318/v1/traces
    // You can use environment variables to configure the endpoint, e.g.,
    // url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
    });
    sdk = new NodeSDK({
        traceExporter, // Re-enabled exporter
        instrumentations: [getNodeAutoInstrumentations()], // Re-enabled instrumentations
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
    }
    else {
        process.exit(0);
    }
});
