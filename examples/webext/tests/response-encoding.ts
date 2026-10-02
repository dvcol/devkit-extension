import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import { deflateSync, gzipSync } from 'node:zlib';

const originalBytes = Buffer.from('original-世界');
const gzipBytes = gzipSync(originalBytes);
const deflateBytes = deflateSync(originalBytes);
const encodedResponses = [
  { name: 'identity-fixed', encoding: null, bytes: originalBytes, fixedLength: true },
  { name: 'gzip-fixed', encoding: 'gzip', bytes: gzipBytes, fixedLength: true },
  { name: 'gzip-chunked', encoding: 'gzip', bytes: gzipBytes, fixedLength: false },
  { name: 'deflate-fixed', encoding: 'deflate', bytes: deflateBytes, fixedLength: true },
  { name: 'deflate-chunked', encoding: 'deflate', bytes: deflateBytes, fixedLength: false },
];

/** Serve only the fixed native encoding/framing cases used by the owned loopback proof. */
export function writeEncodedResponse(path: string, response: ServerResponse): boolean {
  const fixture = encodedResponses.find(({ name }) => path.endsWith(`/${name}`));
  if (fixture === undefined) return false;
  if (fixture.encoding !== null) response.setHeader('Content-Encoding', fixture.encoding);
  if (fixture.fixedLength) {
    response.setHeader('Content-Length', fixture.bytes.length);
    response.end(fixture.bytes);
    return true;
  }
  const middle = Math.ceil(fixture.bytes.length / 2);
  response.write(fixture.bytes.subarray(0, middle));
  response.end(fixture.bytes.subarray(middle));
  return true;
}

/** Read browser-delivered bytes and original native headers, without an extension decompressor. */
export async function readNativeEncodedResponse(path: string) {
  const response = await fetch(new URL(path, location.href), { cache: 'no-store' });
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    status: response.status,
    text: new TextDecoder().decode(bytes),
    byteLength: bytes.byteLength,
    bytes: Array.from(bytes),
    headers: {
      contentEncoding: response.headers.get('content-encoding'),
      contentLength: response.headers.get('content-length'),
      transferEncoding: response.headers.get('transfer-encoding'),
    },
  };
}

export async function checkNativeResponseEncodings(browser: {
  readEncoded(path: string): Promise<unknown>;
}) {
  const observations = [];
  const prefixedBytes = Buffer.concat([Buffer.from('native:'), originalBytes]);
  for (const fixture of encodedResponses) {
    const original = await browser.readEncoded(`/unmatched-response/${fixture.name}`);
    const transformed = await browser.readEncoded(`/transform-response/${fixture.name}`);
    const headers = {
      contentEncoding: fixture.encoding,
      contentLength: fixture.fixedLength ? String(fixture.bytes.length) : null,
      transferEncoding: fixture.fixedLength ? null : 'chunked',
    };
    assert.deepEqual(original, {
      status: 200,
      text: 'original-世界',
      byteLength: originalBytes.length,
      bytes: Array.from(originalBytes),
      headers,
    });
    assert.deepEqual(transformed, {
      status: 200,
      text: 'native:original-世界',
      byteLength: prefixedBytes.length,
      bytes: Array.from(prefixedBytes),
      headers,
    });
    observations.push({
      name: fixture.name,
      wireByteLength: fixture.bytes.length,
      original,
      transformed,
    });
  }
  return observations;
}
