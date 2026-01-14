import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';

const app = new Elysia()
  .use(cors())
  .get('/health', () => ({ status: 'ok' }))
  .get('/ready', () => ({ status: 'ready' }))
  .listen(3002);

console.log(`Monte Carlo Service running on port ${app.server?.port}`);
