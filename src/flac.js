const FLAC_HEADER_LENGTH = 42;
const SAMPLE_COUNT_MASK = (1n << 36n) - 1n;

async function readHeader(response) {
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;

  try {
    while (length < FLAC_HEADER_LENGTH) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      chunks.push(chunk);
      length += chunk.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return Buffer.concat(chunks, length).subarray(0, FLAC_HEADER_LENGTH);
}

export async function inspectFlac(url, timeoutMs = 12_000, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      headers: { Range: `bytes=0-${FLAC_HEADER_LENGTH - 1}` },
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { verified: false, reason: `audio host returned HTTP ${response.status}` };
    }

    const header = await readHeader(response);
    if (header.length < FLAC_HEADER_LENGTH || header.toString('ascii', 0, 4) !== 'fLaC') {
      return { verified: false, reason: 'audio is not a complete FLAC stream' };
    }

    const blockType = header[4] & 0x7f;
    const blockLength = header.readUIntBE(5, 3);
    if (blockType !== 0 || blockLength !== 34) {
      return { verified: false, reason: 'FLAC stream does not start with STREAMINFO' };
    }

    const packed = header.readBigUInt64BE(18);
    const sampleRate = Number(packed >> 44n);
    const channels = Number((packed >> 41n) & 0x7n) + 1;
    const bitDepth = Number((packed >> 36n) & 0x1fn) + 1;
    const totalSamples = packed & SAMPLE_COUNT_MASK;
    const duration = sampleRate > 0 ? Number(totalSamples) / sampleRate : 0;

    if (sampleRate < 8_000 || sampleRate > 384_000 || bitDepth < 4 || bitDepth > 32) {
      return { verified: false, reason: 'FLAC STREAMINFO contains invalid audio metadata' };
    }

    const range = response.headers.get('content-range')?.match(/\/(\d+)$/);
    const contentLength = response.headers.get('content-length');
    const totalBytes = range
      ? Number(range[1])
      : response.status === 200 && contentLength
        ? Number(contentLength)
        : 0;

    return {
      verified: true,
      url: response.url || url,
      info: { sampleRate, bitDepth, channels, duration },
      totalBytes: Number.isFinite(totalBytes) ? totalBytes : 0,
    };
  } catch (error) {
    const cause = error.cause?.code || error.cause?.message;
    return {
      verified: false,
      reason:
        error.name === 'AbortError'
          ? 'audio probe timed out'
          : cause
            ? `audio fetch failed: ${cause}`
            : `audio fetch failed: ${error.message}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function qualityLabel({ sampleRate, bitDepth }) {
  const tier = sampleRate > 48_000 || bitDepth > 16 ? 'Hi-Res Lossless' : 'Lossless';
  return `${tier} · ${bitDepth}-bit / ${Math.round(sampleRate / 100) / 10} kHz`;
}
