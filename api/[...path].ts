import type { IncomingMessage, ServerResponse } from 'node:http';
import app from '../backend.js';

// Vercel serverless function fallback for direct /api/* filesystem matches
export default function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    return app(req as any, res as any);
  } catch (error) {
    console.error('[Vercel Catch-All API Handler Error]:', error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          error: 'Internal server error.',
          code: 'API_HANDLER_FAILURE',
        })
      );
    }
  }
}
