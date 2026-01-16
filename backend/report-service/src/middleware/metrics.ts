import { Elysia } from 'elysia';
import { recordHttpRequest } from '../utils/metrics';

export function metricsMiddleware(app: Elysia): Elysia {
  return app
    .derive(({ request, path, method }) => {
      return {
        startTime: Date.now(),
        requestPath: path,
        requestMethod: method,
      };
    })
    .onAfterHandle(({ startTime, requestPath, requestMethod, response }) => {
      const duration = (Date.now() - startTime) / 1000;
      const status = response?.status || 200;
      recordHttpRequest(requestMethod, requestPath, status, duration);
    });
}
