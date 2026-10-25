const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// tools/ lives inside the repo; the site root is the repo root
const ROOT_DIR = path.resolve(__dirname, '..');
const LEGACY_PREFIX = '/kylrx-enterprise-suite-main';
const API_PORT = Number(process.env.API_PORT) || 3000;

// Browsers on these local origins may call this server cross-origin; everything else gets no CORS headers
const ALLOWED_ORIGINS = new Set([
    'http://127.0.0.1:5500', 'http://localhost:5500',
    'http://127.0.0.1:5501', 'http://localhost:5501',
    'http://127.0.0.1:5502', 'http://localhost:5502',
    'http://127.0.0.1:3000', 'http://localhost:3000'
]);

// RFC 7230 hop-by-hop headers are meaningful for one connection only and must not be proxied
const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];

function stripHopByHop(headers) {
    const named = String(headers.connection || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const out = {};
    for (const [name, value] of Object.entries(headers)) {
        const key = name.toLowerCase();
        if (!HOP_BY_HOP.includes(key) && !named.includes(key)) out[name] = value;
    }
    return out;
}

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.mp3': 'audio/mp3',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf'
};

function requestHandler(req, res) {
    // CORS only for known local origins, and allow popups for Firebase Auth
    res.setHeader('Vary', 'Origin');
    if (ALLOWED_ORIGINS.has(req.headers.origin)) {
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    let urlPath;
    try {
        urlPath = decodeURIComponent(req.url.split('?')[0]);
    } catch (_) {
        // Malformed percent-encoding would otherwise throw and crash the server
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('400 Bad Request');
        return;
    }

    // A NUL byte makes fs throw synchronously, which would crash the server
    if (urlPath.includes('\0')) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('400 Bad Request');
        return;
    }

    // Reverse-proxy /api/* to Express backend on port 3000
    if (urlPath.startsWith('/api/')) {
        const proxyReq = http.request({
            hostname: '127.0.0.1',
            port: API_PORT,
            path: req.url,
            method: req.method,
            headers: stripHopByHop(req.headers)
        }, (proxyRes) => {
            res.writeHead(proxyRes.statusCode, stripHopByHop(proxyRes.headers));
            proxyRes.pipe(res);
        });

        proxyReq.on('error', (err) => {
            if (res.headersSent) {
                res.destroy();
                return;
            }
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Backend API service offline or starting up' }));
        });

        req.pipe(proxyReq);
        return;
    }

    // Old URLs were served from the parent folder and carried the repo name as a prefix
    if (urlPath === LEGACY_PREFIX || urlPath.startsWith(LEGACY_PREFIX + '/')) urlPath = urlPath.slice(LEGACY_PREFIX.length) || '/';

    let safePath = path.normalize(urlPath);
    if (safePath === '/' || safePath === '\\') safePath = '/admin-dashboard.html';

    // Never serve dotfiles (.env, .git), secrets, data stores or dependencies
    const segments = safePath.split(/[\\/]/).filter(Boolean);
    const forbidden = segments.some(s => s.startsWith('.') || s === 'node_modules' || s === 'data') ||
        /serviceAccount|adminsdk|\.pem$|\.key$/i.test(safePath);
    if (forbidden) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('403 Forbidden');
        return;
    }

    const filePath = resolveInside(ROOT_DIR, safePath);

    fs.stat(filePath || '', (err, stats) => {
        if (!filePath || err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`404 Not Found: ${req.url}`);
            return;
        }

        serveFile(filePath, res);
    });
}

// Resolves a request path under baseDir, returning null if it would escape it
function resolveInside(baseDir, requestPath) {
    const resolved = path.resolve(baseDir, '.' + path.sep + requestPath);
    return resolved === baseDir || resolved.startsWith(baseDir + path.sep) ? resolved : null;
}

function serveFile(filePath, res) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const stream = fs.createReadStream(filePath);
    stream.on('open', () => {
        res.writeHead(200, { 'Content-Type': contentType });
        stream.pipe(res);
    });
    stream.on('error', () => {
        if (res.headersSent) {
            res.destroy();
            return;
        }
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 Internal Server Error');
    });
}

function startServerOnPort(port) {
    const s = http.createServer(requestHandler);
    s.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`Port ${port} is already in use by another process.`);
        } else {
            console.error(`Server error on port ${port}:`, err);
        }
    });
    s.listen(port, '0.0.0.0', () => {
        console.log(`🌐 Static Server active on http://127.0.0.1:${port}`);
    });
    return s;
}

function start() {
startServerOnPort(5500);
startServerOnPort(5501);
// 5502 is the Live Server port used by the suite's pages and scratch tests; skipped if Live Server holds it
startServerOnPort(5502);

function ensureBackendRunning() {
    const req = http.get('http://127.0.0.1:3000/api/health', (res) => {
        res.resume();
        console.log('✅ Express Backend is connected on http://127.0.0.1:3000');
    });
    req.on('error', () => {
        console.log('🚀 Launching Express Backend (server.js) on port 3000...');
        const child = spawn(process.execPath, ['server.js'], {
            cwd: ROOT_DIR,
            stdio: 'inherit'
        });
        child.on('error', (err) => console.error('Failed to start backend server.js:', err));
    });
}
ensureBackendRunning();
}

if (require.main === module) start();

module.exports = { requestHandler, start };
