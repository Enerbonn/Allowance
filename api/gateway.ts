import { isIP } from 'node:net';

const noCache = { 'cache-control': 'no-store' };

export async function proxyAllowance(request: Request, upstream = fetch): Promise<Response> {
  const backend = process.env.ALLOWANCE_BACKEND_URL;
  const token = process.env.ALLOWANCE_PROXY_TOKEN;
  if (!backend || !token || token.length < 24) {
    return Response.json({ error: 'The workspace backend is not connected to this deployment.' }, { status: 503, headers: noCache });
  }
  const incoming = new URL(request.url);
  const path = incoming.searchParams.get('route') || '';
  if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(path) || path === 'gateway') {
    return Response.json({ error: 'API route not found.' }, { status: 404, headers: noCache });
  }
  if (!['GET', 'HEAD', 'POST', 'PUT', 'DELETE'].includes(request.method)) {
    return Response.json({ error: 'Method not allowed.' }, { status: 405, headers: noCache });
  }
  const origin = request.headers.get('origin');
  if (origin && origin !== process.env.ALLOWANCE_PUBLIC_ORIGIN) {
    return Response.json({ error: 'Origin not allowed.' }, { status: 403, headers: noCache });
  }

  try {
    const destination = new URL(backend);
    if (destination.protocol !== 'https:' || destination.origin !== backend) throw new Error('Invalid backend origin');
    const headers = new Headers({ 'x-allowance-proxy': token });
    for (const name of ['content-type', 'cookie', 'origin', 'x-allowance-client']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const ip = request.headers.get('x-vercel-forwarded-for')?.split(',')[0].trim();
    if (ip && isIP(ip)) headers.set('x-allowance-client-ip', ip);
    const result = await upstream(new URL('/api/' + path, destination), {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
      redirect: 'manual',
      signal: AbortSignal.timeout(115000),
    });
    if (result.status >= 300 && result.status < 400) throw new Error('Unexpected backend redirect');
    const returned = new Headers(noCache);
    for (const name of ['content-type', 'content-disposition', 'x-content-type-options']) {
      const value = result.headers.get(name);
      if (value) returned.set(name, value);
    }
    for (const cookie of result.headers.getSetCookie()) returned.append('set-cookie', cookie);
    return new Response(result.body, { status: result.status, headers: returned });
  } catch {
    return Response.json({ error: 'The workspace backend could not complete this request.' }, { status: 502, headers: noCache });
  }
}

export default { fetch: (request: Request) => proxyAllowance(request) };
