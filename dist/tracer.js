import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ConsoleSpanExporter, BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
let sdk;
export const initTracer = () => {
    const otlpExporter = new OTLPTraceExporter({});
    const consoleExporter = new ConsoleSpanExporter();
    sdk = new NodeSDK({
        spanProcessors: [new BatchSpanProcessor(consoleExporter), new BatchSpanProcessor(otlpExporter)],
        instrumentations: [getNodeAutoInstrumentations()],
    });
    console.log('DEBUG: NodeSDK initialized with OTLPTraceExporter and Instrumentations (Resource commented out). Calling sdk.start().');
    sdk.start();
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
