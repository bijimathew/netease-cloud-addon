import { inspectFlac, qualityLabel } from './flac.js';

const SEARCH_CACHE_MS = 60_000;
const STREAM_CACHE_MS = 120_000;
const MAX_SEARCH_RESULTS = 20;
const SEARCH_TIMEOUT_MS = 8_000;
const FLAC_BITRATE = 999_000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-max-age': '86400',
};

function jsonResponse(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function makeCache() {
  const values = new Map();
  return {
    get(key) {
      const entry = values.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= Date.now()) {
        values.delete(key);
        return null;
      }
      return entry.value;
    },
    set(key, value, ttlMs) {
      values.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
  };
}

function seconds(value) {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? Math.round(duration / 100) / 10 : 0;
}

function trackRows(songs) {
  return songs
    .filter((song) => song?.id != null && String(song.name || '').trim())
    .map((song) => {
      const artwork = song.al?.picUrl || song.album?.picUrl || '';
      const artists = Array.isArray(song.ar)
        ? song.ar.map((artist) => artist?.name).filter(Boolean).join(', ')
        : Array.isArray(song.artists)
          ? song.artists.map((artist) => artist?.name).filter(Boolean).join(', ')
          : '';

      return {
        id: `ne_${song.id}`,
        title: String(song.name).trim(),
        artist: artists,
        album: String(song.al?.name || song.album?.name || ''),
        ...(seconds(song.dt ?? song.duration) ? { duration: seconds(song.dt ?? song.duration) } : {}),
        ...(typeof artwork === 'string' && artwork.startsWith('https://')
          ? { artworkURL: `${artwork}?param=500y500` }
          : {}),
        format: 'flac',
        audioQuality: 'LOSSLESS',
        source: 'netease',
      };
    });
}

export function createAddon({
  searchBase = process.env.NETEASE_SEARCH_BASE || 'https://music.163.com',
  metingBases = (process.env.METING_BASES || 'https://api.qijieya.cn/meting')
    .split(',')
    .map((base) => base.trim())
    .filter(Boolean),
  bitrate = Number.parseInt(process.env.NETEASE_BITRATE || String(FLAC_BITRATE), 10),
  fetchImpl = fetch,
  logger = console,
} = {}) {
  let catalogBase;
  try {
    catalogBase = new URL(searchBase);
    if (!['http:', 'https:'].includes(catalogBase.protocol)) throw new Error('unsupported protocol');
  } catch {
    throw new Error('NETEASE_SEARCH_BASE must be an absolute HTTP(S) URL');
  }
  catalogBase.pathname = `${catalogBase.pathname.replace(/\/+$/, '')}/`;
  catalogBase.search = '';
  catalogBase.hash = '';

  const configuredMetingBases = [...new Set(metingBases.map((base) => {
    let endpoint;
    try {
      endpoint = new URL(base);
    } catch {
      throw new Error(`Invalid Meting base URL: ${base}`);
    }
    if (!['http:', 'https:'].includes(endpoint.protocol)) {
      throw new Error(`Meting base URL must use HTTP(S): ${base}`);
    }
    endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, '')}/`;
    endpoint.search = '';
    endpoint.hash = '';
    return endpoint.toString();
  }))];
  if (!configuredMetingBases.length) throw new Error('Configure at least one METING_BASES URL');
  if (!Number.isInteger(bitrate) || bitrate <= 0) throw new Error('NETEASE_BITRATE must be a positive integer');

  const manifest = {
    id: 'app.bitchord.netease',
    name: 'NetEase Cloud Music',
    version: '1.0.0',
    resources: ['search', 'stream'],
    allowDownloads: 1,
    checkValidLossless: 0,
  };
  const searchCache = makeCache();
  const streamCache = makeCache();

  async function search(query) {
    const key = query.toLocaleLowerCase();
    const cached = searchCache.get(key);
    if (cached) return cached;
    const url = new URL('/api/cloudsearch/pc', catalogBase);
    url.searchParams.set('s', query);
    url.searchParams.set('type', '1');
    url.searchParams.set('limit', String(MAX_SEARCH_RESULTS));
    url.searchParams.set('offset', '0');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, {
        headers: {
          accept: 'application/json',
          referer: `${catalogBase.origin}/`,
          'user-agent': USER_AGENT,
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`NetEase search returned HTTP ${response.status}`);
      const payload = await response.json();
      const songs = payload?.result?.songs;
      if (!Array.isArray(songs)) {
        const obfuscated = typeof payload?.result === 'string';
        throw new Error(`NetEase search response did not contain result.songs${obfuscated ? ' (possibly blocked)' : ''}`);
      }
      const rows = trackRows(songs).slice(0, MAX_SEARCH_RESULTS);
      searchCache.set(key, rows, SEARCH_CACHE_MS);
      return rows;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('NetEase search timed out');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function resolve(id) {
    if (!/^\d+$/.test(id)) return null;
    const cached = streamCache.get(id);
    if (cached) return cached;

    let inspected;
    let lastReason = 'no Meting endpoint configured';
    for (const base of configuredMetingBases) {
      const url = new URL(base);
      url.searchParams.set('server', 'netease');
      url.searchParams.set('type', 'url');
      url.searchParams.set('id', id);
      url.searchParams.set('br', String(bitrate));
      inspected = await inspectFlac(url.toString(), undefined, fetchImpl);
      if (inspected.verified) break;
      lastReason = inspected.reason;
    }
    if (!inspected?.verified) {
      logger.info?.(`[netease] rejected ${id}: ${lastReason}`);
      return null;
    }

    const measuredBitrate =
      inspected.totalBytes && inspected.info.duration
        ? Math.round((inspected.totalBytes * 8) / inspected.info.duration)
        : undefined;
    const result = {
      url: inspected.url,
      format: 'flac',
      quality: qualityLabel(inspected.info),
      codec: 'flac',
      container: 'flac',
      manifest: 'none',
      encrypted: false,
      sampleRate: inspected.info.sampleRate,
      bitDepth: inspected.info.bitDepth,
      channels: inspected.info.channels,
      ...(measuredBitrate ? { bitrate: measuredBitrate } : {}),
    };
    streamCache.set(id, result, STREAM_CACHE_MS);
    return result;
  }

  async function handle(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return jsonResponse({ error: 'method not allowed' }, 405);
    }

    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path === '/' || path === '/manifest.json') return jsonResponse(manifest);
    if (path === '/health') {
      return jsonResponse({
        ok: true,
        searchBase: catalogBase.origin,
        metingEndpoints: configuredMetingBases.length,
      });
    }
    if (path === '/search') {
      const query = (url.searchParams.get('q') || '').trim();
      if (!query) return jsonResponse({ tracks: [] });
      if (query.length > 200) return jsonResponse({ error: 'query too long' }, 400);
      try {
        return jsonResponse({ tracks: await search(query) });
      } catch (error) {
        logger.error?.(`[netease] search failed: ${error.message}`);
        return jsonResponse({ error: 'NetEase search is temporarily unavailable' }, 502);
      }
    }
    if (path.startsWith('/stream/')) {
      let id;
      try {
        id = decodeURIComponent(path.slice('/stream/'.length));
      } catch {
        return jsonResponse({ error: 'malformed track id' }, 400);
      }
      if (!id) return jsonResponse({ error: 'track not found' }, 404);
      if (!id.startsWith('ne_')) return jsonResponse({ error: 'track not found' }, 404);
      try {
        const stream = await resolve(id.slice(3));
        return stream ? jsonResponse(stream) : jsonResponse({ error: 'track not found or not lossless' }, 404);
      } catch (error) {
        logger.error?.(`[netease] stream lookup failed: ${error.message}`);
        return jsonResponse({ error: 'NetEase stream is temporarily unavailable' }, 502);
      }
    }

    return jsonResponse({ error: 'not found' }, 404);
  }

  return { handle, manifest };
}
