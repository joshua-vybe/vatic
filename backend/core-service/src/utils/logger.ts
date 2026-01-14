interface LogContext {
  [key: string]: any;
}

export interface Logger {
  info(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
}

export function createLogger(service: string): Logger {
  const formatLog = (level: string, message: string, context?: LogContext) => {
    const timestamp = new Date().toISOString();
    const log = {
      timestamp,
      level,
      service,
      message,
      ...(context && { context }),
    };
    return JSON.stringify(log);
  };

  return {
    info: (message: string, context?: LogContext) => {
      console.log(formatLog('INFO', message, context));
    },
    error: (message: string, context?: LogContext) => {
      console.error(formatLog('ERROR', message, context));
    },
    warn: (message: string, context?: LogContext) => {
      console.warn(formatLog('WARN', message, context));
    },
    debug: (message: string, context?: LogContext) => {
      console.debug(formatLog('DEBUG', message, context));
    },
  };
}
