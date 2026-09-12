import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.gb7': 'application/octet-stream', '.json': 'application/json; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const target = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!target.startsWith(root + sep) || relative(root, target).split(/[\\/]/).some(part => part.startsWith('.'))) {
      res.writeHead(403).end('Forbidden'); return;
    }
    const body = await readFile(target);
    res.writeHead(200, { 'Content-Type': types[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  } catch { res.writeHead(404).end('Not found'); }
});
let port = Number(process.env.PORT || process.argv[2] || 5173);
server.on('error', error => {
  if (error.code === 'EADDRINUSE' && port < 5200) server.listen(++port, '127.0.0.1');
  else { console.error(error); process.exit(1); }
});
server.listen(port, '127.0.0.1', () => console.log(`Пиксель: http://localhost:${port}`));
