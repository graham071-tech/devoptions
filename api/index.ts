import app from '../backend';

/**
 * Vercel may pass either the full /api/... URL or a path relative to the
 * function. Express routes are registered with the /api prefix, so normalize
 * the URL before handing the request to Express.
 */
function handler(req: any, res: any) {
  const requestUrl = typeof req.url === 'string' ? req.url : '/';
  const pathname = requestUrl.split('?')[0];

  if (pathname !== '/api' && !pathname.startsWith('/api/')) {
    req.url = `/api${requestUrl.startsWith('/') ? '' : '/'}${requestUrl}`;
  }

  return app(req, res);
}

export default handler;
