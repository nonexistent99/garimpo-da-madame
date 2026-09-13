import { get, list, put } from '@vercel/blob';

export async function readJson(pathname) {
  const result = await get(pathname, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200) return null;
  return new Response(result.stream).json();
}

export async function writeJson(pathname, value) {
  await put(pathname, JSON.stringify(value), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

export async function listJson(prefix, limit = 500) {
  const result = await list({ prefix, limit });
  return (await Promise.all(result.blobs.map(blob => readJson(blob.pathname)))).filter(Boolean);
}
