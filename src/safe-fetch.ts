import { lookup } from 'node:dns/promises';
import https from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import { isForbiddenAddress, validatePublicHttpsUrl } from './agent-access.js';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;

/**
 * Fetches only public HTTPS origins. DNS is resolved before each connection and
 * the vetted IP is used directly, closing the DNS-rebinding gap in global fetch.
 */
export async function safeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = requestUrl(input);
  return safeFetchUrl(url, init, 0, url.origin);
}

async function safeFetchUrl(url: URL, init: RequestInit, redirects: number, origin: string): Promise<Response> {
  validatePublicHttpsUrl(url.toString());
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((address) => isForbiddenAddress(address.address))) {
    throw new Error('source URL must resolve only to public network addresses');
  }

  const address = addresses[0]!;
  const method = init.method ?? 'GET';
  const body = requestBody(init.body);
  const headers = new Headers(init.headers);
  headers.delete('host');
  headers.set('host', url.host);
  if (body && !headers.has('content-length')) headers.set('content-length', String(body.length));

  return new Promise<Response>((resolve, reject) => {
    const request = https.request({
      protocol: 'https:',
      hostname: address.address,
      family: address.family,
      port: url.port ? Number(url.port) : 443,
      path: `${url.pathname}${url.search}`,
      method,
      headers: headersRecord(headers),
      servername: url.hostname,
      signal: init.signal ?? undefined,
    }, (response) => {
      const status = response.statusCode ?? 502;
      const location = firstHeader(response.headers, 'location');
      if (isRedirect(status) && location) {
        response.resume();
        response.once('end', () => {
          if (redirects >= MAX_REDIRECTS) return reject(new Error('source URL exceeded redirect limit'));
          const nextUrl = new URL(location, url);
          if (nextUrl.origin !== origin) return reject(new Error('source URL may not redirect to a different origin'));
          const nextInit = redirectInit(init, status);
          void safeFetchUrl(nextUrl, nextInit, redirects + 1, origin).then(resolve, reject);
        });
        return;
      }
      collectResponse(response, status).then(resolve, reject);
    });
    request.once('error', reject);
    request.end(body);
  });
}

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) return new URL(input.toString());
  if (typeof input === 'string') return new URL(input);
  return new URL(input.url);
}

function requestBody(body: RequestInit['body']): Buffer | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  throw new Error('safe fetch supports only string or byte request bodies');
}

function redirectInit(init: RequestInit, status: number): RequestInit {
  if ((status === 301 || status === 302 || status === 303) && (init.method ?? 'GET') !== 'GET' && (init.method ?? 'GET') !== 'HEAD') {
    const headers = new Headers(init.headers);
    headers.delete('content-length');
    const { body: _body, ...withoutBody } = init;
    return { ...withoutBody, method: 'GET', headers };
  }
  return init;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function collectResponse(response: import('node:http').IncomingMessage, status: number): Promise<Response> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_RESPONSE_BYTES) {
      response.destroy(new Error(`source response exceeds ${MAX_RESPONSE_BYTES} bytes`));
      throw new Error(`source response exceeds ${MAX_RESPONSE_BYTES} bytes`);
    }
    chunks.push(buffer);
  }
  const body = Buffer.concat(chunks);
  return new Response(responseStatusAllowsBody(status) ? body : null, { status, headers: responseHeaders(response.headers) });
}

export function responseStatusAllowsBody(status: number): boolean {
  return status !== 204 && status !== 205 && status !== 304;
}

function responseHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item);
    } else if (value !== undefined) {
      result.set(name, value);
    }
  }
  return result;
}

function firstHeader(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function headersRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => { result[key] = value; });
  return result;
}
