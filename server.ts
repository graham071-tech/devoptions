import app from './backend';

const PORT = Number(process.env.PORT || 3000);

if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[DevOptions Server] Running on http://0.0.0.0:${PORT}`);
  });
}

export default app;
