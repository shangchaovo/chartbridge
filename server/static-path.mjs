import path from 'node:path';

export function resolveStaticPath(dist, pathname, paths = path) {
  if (pathname.includes('\0')) throw Object.assign(new Error('URL 无效。'), { status: 400 });
  const file = paths.resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
  const relative = paths.relative(dist, file);
  if (!relative || relative === '..' || relative.startsWith(`..${paths.sep}`) || paths.isAbsolute(relative)) {
    throw Object.assign(new Error('路径无效。'), { status: 403 });
  }
  return file;
}
