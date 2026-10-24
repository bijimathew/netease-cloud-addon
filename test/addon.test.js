import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { createAddon } from '../src/addon.js';

let upstream;
let upstreamUrl;
let api;
let audioIsFlac = true;
let searchCalls = 0;
let metingCalls = 0;

const flac = Buffer.alloc(42);
flac.write('fLaC', 0, 'ascii');
flac[4] = 0;
flac.writeUIntBE(34, 5, 3);
const packed = (44_100n << 44n) | (1n << 41n) | (15n << 36n) | (44_100n * 180n);
flac.writeBigUInt64BE(packed, 18);

before(async () => {
  upstream = createServer(async (request, response) => {
    if (request.url.startsWith('/api/cloudsearch/pc?')) {
      searchCalls += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          code: 200,
          result: {
            songs: [
              {
                id: 123,
                name: 'Test Track',
                ar: [{ name: 'Test Artist' }],
                al: { name: 'Test Album', picUrl: 'https://example.test/cover.jpg' },
                dt: 180_000,
              },
            ],
          },
        }),
      );
      return;
    }
    if (request.url.startsWith('/meting/?')) {
      metingCalls += 1;
      const query = new URL(request.url, upstreamUrl).searchParams;
      if (query.get('server') !== 'netease' || query.get('type') !== 'url' || query.get('br') !== '999000') {
        response.writeHead(400);
        response.end();
        return;
      }
      response.writeHead(302, { location: `${upstreamUrl}/audio.flac` });
      response.end();
      return;
    }
    if (request.url === '/audio.flac') {
      const bytes = audioIsFlac ? flac : Buffer.from('not an audio file');
      response.writeHead(206, {
        'content-type': 'application/octet-stream',
        'content-range': `bytes 0-${bytes.length - 1}/${bytes.length}`,
      });
      response.end(bytes);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  api = createAddon({
    searchBase: upstreamUrl,
    metingBases: [`${upstreamUrl}/meting`],
    logger: { info() {}, error() {} },
  });
});

after(async () => {
  await new Promise((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
});

test('serves the BitChord addon manifest', async () => {
  const response = await api.handle(new Request('http://addon.test/manifest.json'));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).resources, ['search', 'stream']);
});

test('searches the public NetEase catalog and returns BitChord rows', async () => {
  const response = await api.handle(new Request('http://addon.test/search?q=Test%20Track'));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.tracks[0].id, 'ne_123');
  assert.equal(payload.tracks[0].title, 'Test Track');
  assert.equal(payload.tracks[0].artist, 'Test Artist');
  assert.equal(payload.tracks[0].audioQuality, 'LOSSLESS');
  assert.equal(searchCalls, 1);
});

test('resolves through Meting and verifies FLAC before returning metadata', async () => {
  const response = await api.handle(new Request('http://addon.test/stream/ne_123'));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.format, 'flac');
  assert.equal(payload.sampleRate, 44_100);
  assert.equal(payload.bitDepth, 16);
  assert.equal(payload.quality, 'Lossless · 16-bit / 44.1 kHz');
  assert.equal(metingCalls, 1);
});

test('rejects a stream that is not FLAC', async () => {
  audioIsFlac = false;
  const response = await api.handle(new Request('http://addon.test/stream/ne_124'));
  assert.equal(response.status, 404);
  audioIsFlac = true;
});

test('rejects malformed track ids without contacting the upstream API', async () => {
  const response = await api.handle(new Request('http://addon.test/stream/ne_not-a-number'));
  assert.equal(response.status, 404);
});
