import winston from 'winston';
import { getCorrelationId } from './correlation-id';

export type Logger = winston.Logger;

const winstonLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: {},
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.json()
      ),
    }),
  ],
});

export function createLogger(service: string): Logger {
  return winstonLogger.child({
    service,
    get correlation_id() {
      return getCorrelationId();
    },
  });
}
