import { stableStringify } from '../stable';
import type { JsonObject, JsonValue, Lane } from '../types';

export type LogLevel = 'debug' | 'error' | 'info' | 'warn';

export type LogContext = {
  enforcement?: 'allowed' | 'denied';
  kernelStatus?: number;
  lane?: Lane;
  requestId?: string;
  sessionId?: string;
  spanId?: string;
  traceId?: string;
  [key: string]: JsonValue | undefined;
};

export type LogRecord = LogContext & {
  event: string;
  level: LogLevel;
};

export interface LogSink {
  emit(record: LogRecord, serialized: string): void;
}

export class ConsoleJsonLogSink implements LogSink {
  emit(record: LogRecord, serialized: string): void {
    const writers: Record<LogLevel, (message: string) => void> = {
      debug: console.debug,
      error: console.error,
      info: console.info,
      warn: console.warn,
    };
    writers[record.level](serialized);
  }
}

export class StructuredLogger {
  constructor(
    private readonly sink: LogSink,
    private readonly context: LogContext = {},
  ) {}

  child(context: LogContext): StructuredLogger {
    return new StructuredLogger(this.sink, { ...this.context, ...context });
  }

  debug(event: string, context: LogContext = {}): void {
    this.write('debug', event, context);
  }

  info(event: string, context: LogContext = {}): void {
    this.write('info', event, context);
  }

  warn(event: string, context: LogContext = {}): void {
    this.write('warn', event, context);
  }

  error(event: string, context: LogContext = {}): void {
    this.write('error', event, context);
  }

  private write(level: LogLevel, event: string, context: LogContext): void {
    const record = Object.fromEntries(
      Object.entries({ ...this.context, ...context, event, level })
        .filter(([, value]) => value !== undefined),
    ) as LogRecord;
    this.sink.emit(record, stableStringify(record as JsonObject));
  }
}

export const defaultLogger = new StructuredLogger(new ConsoleJsonLogSink());
