import app from '../backend';

// Route every /api/* request through the Express application while preserving
// the original request path (for example /api/auth/login).
export default app;
