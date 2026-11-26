export {};
// Local dev server. Uses an in-memory message store unless DATABASE_URL is set.
// Placeholder secrets are for the in-memory store only. With a real database, real secrets are required.
if (!process.env.DATABASE_URL) {
  process.env.CONFIRM_SECRET ??= 'local-dev-only-secret-0123456789abcdef';
  process.env.INBOX_TOKEN ??= 'local-dev-inbox-token-0123456789';
} else if (!process.env.CONFIRM_SECRET || !process.env.INBOX_TOKEN) {
  throw new Error('DATABASE_URL is set: set CONFIRM_SECRET and INBOX_TOKEN too');
}
const { createApp } = await import('../src/app.js');
const port = Number(process.env.PORT ?? 3000);
createApp({ baseUrl: `http://localhost:${port}` }).listen(port, () => console.log(`Agent Dan facts API on http://localhost:${port}`));
