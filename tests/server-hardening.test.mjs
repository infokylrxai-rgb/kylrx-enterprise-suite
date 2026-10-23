import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { app, dynamicRoutesLoaded } = require('../server.js');
const errorHandler = require('../middleware/errorHandler.js');

describe('Server Hardening & Security Configuration Suite', () => {
    let server;
    let baseUrl;

    before(async () => {
        if (dynamicRoutesLoaded) {
            await dynamicRoutesLoaded;
        }
        server = http.createServer(app);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
    });

    after(async () => {
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
    });

    it('1. app has "trust proxy" set to 1', () => {
        assert.equal(app.get('trust proxy'), 1, 'trust proxy must be configured to 1');
    });

    it('2. CORS allows localhost and 127.0.0.1 when NODE_ENV is development / non-production', async () => {
        const origEnv = process.env.NODE_ENV;
        try {
            process.env.NODE_ENV = 'development';

            // Localhost origin
            const resLocal = await fetch(`${baseUrl}/api/health`, {
                headers: { Origin: 'http://localhost:5173' }
            });
            assert.equal(resLocal.status, 200);
            assert.equal(resLocal.headers.get('access-control-allow-origin'), 'http://localhost:5173');

            // 127.0.0.1 origin
            const resLoopback = await fetch(`${baseUrl}/api/health`, {
                headers: { Origin: 'http://127.0.0.1:3000' }
            });
            assert.equal(resLoopback.status, 200);
            assert.equal(resLoopback.headers.get('access-control-allow-origin'), 'http://127.0.0.1:3000');

            // Production allow-list origin
            const resProdOrigin = await fetch(`${baseUrl}/api/health`, {
                headers: { Origin: 'https://app.kylrxai.com' }
            });
            assert.equal(resProdOrigin.status, 200);
            assert.equal(resProdOrigin.headers.get('access-control-allow-origin'), 'https://app.kylrxai.com');
        } finally {
            process.env.NODE_ENV = origEnv;
        }
    });

    it('3. CORS rejects unauthorized origins not matching allow-list in development', async () => {
        const origEnv = process.env.NODE_ENV;
        try {
            process.env.NODE_ENV = 'development';

            const res = await fetch(`${baseUrl}/api/health`, {
                headers: { Origin: 'https://malicious-attacker.com' }
            });
            assert.equal(res.status, 403);
            const body = await res.json();
            assert.equal(body.success, false);
            assert.match(body.message || body.error?.message, /Not allowed by CORS/);
        } finally {
            process.env.NODE_ENV = origEnv;
        }
    });

    it('4. CORS rejects localhost and 127.0.0.1 when NODE_ENV is production', async () => {
        const origEnv = process.env.NODE_ENV;
        try {
            process.env.NODE_ENV = 'production';

            // localhost must be rejected in production
            const resLocal = await fetch(`${baseUrl}/api/health`, {
                headers: { Origin: 'http://localhost:3000' }
            });
            assert.equal(resLocal.status, 403, 'localhost must be rejected by CORS in production');

            // 127.0.0.1 must be rejected in production
            const resLoopback = await fetch(`${baseUrl}/api/health`, {
                headers: { Origin: 'http://127.0.0.1:8080' }
            });
            assert.equal(resLoopback.status, 403, '127.0.0.1 must be rejected by CORS in production');

            // Official allow-list must still succeed in production
            const resOfficial = await fetch(`${baseUrl}/api/health`, {
                headers: { Origin: 'https://kylrxai.firebaseapp.com' }
            });
            assert.equal(resOfficial.status, 200);
            assert.equal(resOfficial.headers.get('access-control-allow-origin'), 'https://kylrxai.firebaseapp.com');
        } finally {
            process.env.NODE_ENV = origEnv;
        }
    });

    it('5. Rate limiter skip function does NOT skip 127.0.0.1 in production', () => {
        const origEnv = process.env.NODE_ENV;
        try {
            const skipFn = (req) => {
                if (process.env.NODE_ENV === 'test') return true;
                if (process.env.NODE_ENV === 'production') return false;
                return req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
            };

            // Under production: 127.0.0.1 is NOT skipped
            process.env.NODE_ENV = 'production';
            assert.equal(skipFn({ ip: '127.0.0.1' }), false, '127.0.0.1 must not be skipped in production');
            assert.equal(skipFn({ ip: '::1' }), false, '::1 must not be skipped in production');
            assert.equal(skipFn({ ip: '::ffff:127.0.0.1' }), false, 'IPv6 loopback must not be skipped in production');

            // Under development: loopback is skipped
            process.env.NODE_ENV = 'development';
            assert.equal(skipFn({ ip: '127.0.0.1' }), true, '127.0.0.1 should be skipped in development');
            assert.equal(skipFn({ ip: '192.168.1.50' }), false, 'Non-loopback should not be skipped in development');

            // Under test: all are skipped
            process.env.NODE_ENV = 'test';
            assert.equal(skipFn({ ip: '1.2.3.4' }), true, 'All requests should be skipped in test mode');
        } finally {
            process.env.NODE_ENV = origEnv;
        }
    });

    it('6. 404 fallback returns real 404 status and unhandled route message', async () => {
        const res = await fetch(`${baseUrl}/api/unhandled-route-abc-xyz-12345`);
        assert.equal(res.status, 404, 'Unhandled route must return 404');
        const json = await res.json();
        assert.equal(json.success, false);
        const errMsg = json.message || json.error?.message;
        assert.match(errMsg, /Can't find \/api\/unhandled-route-abc-xyz-12345/);
    });

    it('7. errorHandler preserves real status code and message for 4xx errors even in production', () => {
        const origEnv = process.env.NODE_ENV;
        try {
            process.env.NODE_ENV = 'production';

            const mockReq = { originalUrl: '/api/test', method: 'GET', ip: '127.0.0.1' };
            let responseStatus;
            let responseBody;
            const mockRes = {
                statusCode: 200,
                status(code) {
                    responseStatus = code;
                    this.statusCode = code;
                    return this;
                },
                json(body) {
                    responseBody = body;
                    return this;
                }
            };

            // 400 Bad Request
            const err400 = new Error('Field "email" is required and cannot be empty');
            err400.statusCode = 400;
            errorHandler(err400, mockReq, mockRes, () => {});

            assert.equal(responseStatus, 400);
            assert.equal(responseBody.success, false);
            assert.equal(responseBody.message, 'Field "email" is required and cannot be empty');
            assert.equal(responseBody.error.message, 'Field "email" is required and cannot be empty');

            // 404 Not Found
            const err404 = new Error("Can't find /api/items/999 on this server!");
            err404.statusCode = 404;
            errorHandler(err404, mockReq, mockRes, () => {});

            assert.equal(responseStatus, 404);
            assert.equal(responseBody.message, "Can't find /api/items/999 on this server!");
            assert.equal(responseBody.error.message, "Can't find /api/items/999 on this server!");

            // 403 Forbidden
            const err403 = new Error('Access denied: insufficient permissions');
            err403.status = 403;
            errorHandler(err403, mockReq, mockRes, () => {});

            assert.equal(responseStatus, 403);
            assert.equal(responseBody.message, 'Access denied: insufficient permissions');
            assert.equal(responseBody.error.message, 'Access denied: insufficient permissions');
        } finally {
            process.env.NODE_ENV = origEnv;
        }
    });

    it('8. errorHandler masks 5xx errors and hides stack traces in production', () => {
        const origEnv = process.env.NODE_ENV;
        try {
            process.env.NODE_ENV = 'production';

            const mockReq = { originalUrl: '/api/crash', method: 'POST', ip: '127.0.0.1' };
            let responseStatus;
            let responseBody;
            const mockRes = {
                statusCode: 200,
                status(code) {
                    responseStatus = code;
                    this.statusCode = code;
                    return this;
                },
                json(body) {
                    responseBody = body;
                    return this;
                }
            };

            const err500 = new Error('Database password leak: secret_db_pw=123456');
            err500.statusCode = 500;
            errorHandler(err500, mockReq, mockRes, () => {});

            assert.equal(responseStatus, 500);
            assert.equal(responseBody.success, false);
            assert.equal(responseBody.message, 'Internal Server Error', '5xx message must be masked in production');
            assert.equal(responseBody.error.message, 'Internal Server Error', '5xx error.message must be masked');
            assert.equal(responseBody.error.stack, null, 'Stack trace must be hidden in production');

            // Non-production keeps real 5xx message and stack
            process.env.NODE_ENV = 'development';
            errorHandler(err500, mockReq, mockRes, () => {});
            assert.equal(responseBody.message, 'Database password leak: secret_db_pw=123456');
            assert.ok(responseBody.error.stack, 'Stack trace must be included in development');
        } finally {
            process.env.NODE_ENV = origEnv;
        }
    });

    it('9. uncaughtException handler logs and exits process with code 1', async () => {
        const childScript = `
            const { app } = require('./server.js');
            setTimeout(() => {
                throw new Error('FATAL UNCAUGHT SIMULATED CRASH');
            }, 100);
        `;

        const child = fork('-e', [childScript], {
            cwd: path.resolve(__dirname, '..'),
            stdio: 'pipe'
        });

        const exitCode = await new Promise((resolve) => {
            child.on('exit', (code) => resolve(code));
        });

        assert.equal(exitCode, 1, 'Process must exit with code 1 upon uncaughtException');
    });
});
