/**
 * Vercel serverless entry point. Every /api/* request is rewritten here
 * (see vercel.json) and handed to the same Express app the local server uses.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../src/server/app.js';

const app = createApp();

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return (app as unknown as (r: IncomingMessage, s: ServerResponse) => void)(req, res);
}
