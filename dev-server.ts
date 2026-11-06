import { createServer } from 'vite';
import app from './backend';

const port = Number(process.env.PORT || 3000);

async function startDevelopmentServer() {
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
  app.listen(port, '0.0.0.0', () => {
    console.log(`[DevOptions] Development server listening on http://0.0.0.0:${port}`);
  });
}

startDevelopmentServer().catch((error) => {
  console.error('[DevOptions] Could not start development server:', error);
  process.exit(1);
});
