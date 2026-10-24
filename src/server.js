import { createServer } from 'node:http';
import { createAddon } from './addon.js';

const port = Number.parseInt(process.env.PORT || '8787', 10);
const host = process.env.HOST || '0.0.0.0';
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

const addon = createAddon();
const server = createServer(async (request, response) => {
  try {
    const body = await addon.handle(
      new Request(`http://${request.headers.host || 'localhost'}${request.url}`, {
        method: request.method,
        headers: request.headers,
      }),
    );
    response.writeHead(body.status, Object.fromEntries(body.headers));
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    response.end(Buffer.from(await body.arrayBuffer()));
  } catch (error) {
    console.error(`[server] request failed: ${error.message}`);
    response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'internal server error' }));
  }
});

server.listen(port, host, () => {
  console.log(`BitChord NetEase addon listening on http://${host}:${port}`);
  console.log(`NetEase catalog: ${process.env.NETEASE_SEARCH_BASE || 'https://music.163.com'}`);
  console.log(
    `Meting endpoints: ${(process.env.METING_BASES || 'https://api.qijieya.cn/meting')
      .split(',')
      .map((base) => base.trim())
      .filter(Boolean)
      .length}`,
  );
});
