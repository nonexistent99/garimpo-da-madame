const UPSTREAM = 'https://garimpo-api-production.up.railway.app';

export async function upstream(request, path, body) {
  const headers = new Headers();
  for (const name of ['accept', 'content-type', 'cookie', 'x-csrf-token']) {
    const value = request.headers[name];
    if (value) headers.set(name, value);
  }
  return fetch(`${UPSTREAM}${path}`, { method: request.method, headers, body, redirect: 'manual' });
}

export async function relay(source, response) {
  response.statusCode = source.status;
  response.setHeader('Cache-Control', 'no-store');
  const contentType = source.headers.get('content-type');
  if (contentType) response.setHeader('Content-Type', contentType);
  response.end(Buffer.from(await source.arrayBuffer()));
}
