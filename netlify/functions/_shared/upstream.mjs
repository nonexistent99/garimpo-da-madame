const UPSTREAM = 'https://garimpo-api-production.up.railway.app';

export async function upstream(request, path, body) {
  const headers = new Headers();
  for (const name of [
    'accept', 'content-type', 'cookie', 'x-csrf-token',
    'x-lastlink-secret', 'x-lastlink-token', 'x-lastlink-signature',
    'x-hub-signature-256', 'authorization',
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return fetch(`${UPSTREAM}${path}`, {
    method: request.method,
    headers,
    body,
    redirect: 'manual',
  });
}

export async function relay(response) {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  const contentType = response.headers.get('content-type');
  if (contentType) headers.set('Content-Type', contentType);
  return new Response(await response.arrayBuffer(), { status: response.status, headers });
}
