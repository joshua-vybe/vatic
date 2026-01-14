import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';

const app = new Elysia()
  .use(cors())
  .get('/health', () => ({ status: 'ok' }))
  .get('/ready', () => ({ status: 'ready' }))
  .listen(3001);

console.log(`Market Data Service running on port ${app.server?.port}`);
