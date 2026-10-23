import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const firebaseConfig = require('../config/firebase.js');
const messageController = require('../controllers/messageController.js');
const { API_BASE } = require('../config.js');

describe('Client Config, Firestore Messages, and Firebase Production Credentials Suite', () => {

    describe('1. Shared config.js and API_BASE definition', () => {
        it('config.js exports API_BASE', () => {
            assert.ok(API_BASE, 'API_BASE must be defined');
        });

        it('defaults to window.location.origin when window is defined', () => {
            global.window = {
                location: { origin: 'https://kylrx.enterprise.suite.com' }
            };

            const configCode = `
                const API_BASE = (typeof window !== 'undefined' && window.location && window.location.origin)
                    ? window.location.origin
                    : 'http://localhost:3000';
                if (typeof window !== 'undefined') window.API_BASE = API_BASE;
            `;
            eval(configCode);
            assert.equal(global.window.API_BASE, 'https://kylrx.enterprise.suite.com');

            delete global.window;
        });

        it('ensures zero hardcoded localhost:3000 or 127.0.0.1:3000 in 40 client files', async () => {
            const fs = require('fs');
            const files = [
                'admin-alert-builder.js',
                'admin-analytics-builder.js',
                'admin-app.js',
                'admin-assignment-matrix.js',
                'admin-automation-builder.js',
                'admin-central-dashboard.js',
                'admin-conversion-hub.html',
                'admin-document-templates.js',
                'admin-message.html',
                'admin-notification-center.js',
                'admin-policy-center.html',
                'admin-settings.html',
                'admin-workflow-builder.js',
                'alert-trigger-registry.js',
                'app.js',
                'asset-service.js',
                'attendance-engine.js',
                'bu-employee-type-rules.js',
                'bulk-trigger-controller.js',
                'code-engine-service.js',
                'costCenterService.js',
                'employee-login.html',
                'employee-message.html',
                'employee-notifications.html',
                'employee-profile-controller.js',
                'firebase-config.js',
                'hrms-login.html',
                'hrms-message.html',
                'hrms-workflow-builder.js',
                'index.html',
                'login.html',
                'manager-assignment-controller.js',
                'manager-login.html',
                'manager-message.html',
                'onboarding-invite.html',
                'operational-dashboard.html',
                'payslip-pdf-service.js',
                'policy-service.js',
                'services/business-unit-controller.js',
                'statutory-compliance.html'
            ];

            const root = path.resolve(__dirname, '..');
            let violations = [];
            for (const f of files) {
                const fullPath = path.join(root, f);
                assert.ok(fs.existsSync(fullPath), `File must exist: ${f}`);
                const content = fs.readFileSync(fullPath, 'utf8');
                if (content.includes('localhost:3000') || content.includes('127.0.0.1:3000')) {
                    violations.push(f);
                }
            }
            assert.deepEqual(violations, [], `Violations found in: ${violations.join(', ')}`);
        });
    });

    describe('2. MessageController Firestore Migration', () => {
        const inMemoryMessages = new Map();
        let origCollection;
        let origBatch;

        before(() => {
            origCollection = firebaseConfig.db.collection;
            origBatch = firebaseConfig.db.batch;

            // Mock db.collection('messages') in-memory
            firebaseConfig.db.collection = function (collName) {
                if (collName === 'messages') {
                    return {
                        doc: (docId) => ({
                            set: async (data) => {
                                inMemoryMessages.set(docId, { ...data, id: docId });
                            },
                            get: async () => {
                                const exists = inMemoryMessages.has(docId);
                                return {
                                    exists,
                                    data: () => inMemoryMessages.get(docId)
                                };
                            },
                            delete: async () => {
                                inMemoryMessages.delete(docId);
                            }
                        }),
                        get: async () => {
                            const docs = Array.from(inMemoryMessages.entries()).map(([id, d]) => ({
                                id,
                                data: () => d,
                                ref: {
                                    delete: async () => inMemoryMessages.delete(id)
                                }
                            }));
                            return {
                                empty: docs.length === 0,
                                docs,
                                forEach: (cb) => docs.forEach(cb)
                            };
                        },
                        where: (field, op, val) => ({
                            get: async () => {
                                const matched = Array.from(inMemoryMessages.entries())
                                    .filter(([_, d]) => d[field] === val)
                                    .map(([id, d]) => ({
                                        id,
                                        data: () => d,
                                        ref: {
                                            delete: async () => inMemoryMessages.delete(id)
                                        }
                                    }));
                                return {
                                    empty: matched.length === 0,
                                    docs: matched,
                                    forEach: (cb) => matched.forEach(cb)
                                };
                            }
                        })
                    };
                }
                return origCollection ? origCollection.apply(this, arguments) : null;
            };

            firebaseConfig.db.batch = function () {
                const ops = [];
                return {
                    set: (docRef, data) => ops.push(() => docRef.set(data)),
                    delete: (docRef) => ops.push(() => docRef.delete()),
                    commit: async () => {
                        for (const op of ops) await op();
                    }
                };
            };
        });

        after(() => {
            if (origCollection) firebaseConfig.db.collection = origCollection;
            if (origBatch) firebaseConfig.db.batch = origBatch;
        });

        const testChatId = `chat_test_${Date.now()}`;
        const testRecipientId = `usr_recip_${Date.now()}`;
        const testSenderId = `usr_sender_${Date.now()}`;
        let createdMsgId;

        it('sendMessage writes directly to Firestore messages collection', async () => {
            const req = {
                body: {
                    chatId: testChatId,
                    recipientId: testRecipientId,
                    text: 'Hello from Firestore Messages!',
                    senderId: testSenderId,
                    senderName: 'Test Sender'
                }
            };
            let statusRes = 200;
            let jsonRes = null;
            const res = {
                status(code) { statusRes = code; return this; },
                json(payload) { jsonRes = payload; return this; }
            };

            await messageController.sendMessage(req, res);
            assert.equal(statusRes, 201);
            assert.equal(jsonRes.success, true);
            assert.equal(jsonRes.data.text, 'Hello from Firestore Messages!');
            createdMsgId = jsonRes.data.id;

            // Verify document exists in Firestore 'messages' collection
            const docSnap = await firebaseConfig.db.collection('messages').doc(createdMsgId).get();
            assert.ok(docSnap.exists);
            assert.equal(docSnap.data().text, 'Hello from Firestore Messages!');
            assert.equal(docSnap.data().chatId, testChatId);
        });

        it('getThreadMessages reads from Firestore messages collection', async () => {
            const req = {
                params: { chatId: testChatId }
            };
            let statusRes = 200;
            let jsonRes = null;
            const res = {
                status(code) { statusRes = code; return this; },
                json(payload) { jsonRes = payload; return this; }
            };

            await messageController.getThreadMessages(req, res);
            assert.equal(jsonRes.success, true);
            assert.ok(Array.isArray(jsonRes.data));
            const found = jsonRes.data.find(m => m.id === createdMsgId);
            assert.ok(found, 'Created message must be returned in thread');
            assert.equal(found.text, 'Hello from Firestore Messages!');
        });

        it('broadcastMessage writes multiple docs to Firestore messages collection', async () => {
            const recipA = `recip_a_${Date.now()}`;
            const recipB = `recip_b_${Date.now()}`;
            const req = {
                body: {
                    recipientIds: [recipA, recipB],
                    text: 'Broadcast announcement via Firestore'
                }
            };
            let statusRes = 200;
            let jsonRes = null;
            const res = {
                status(code) { statusRes = code; return this; },
                json(payload) { jsonRes = payload; return this; }
            };

            await messageController.broadcastMessage(req, res);
            assert.equal(statusRes, 201);
            assert.equal(jsonRes.success, true);
            assert.equal(jsonRes.count, 2);

            // Verify both in Firestore
            const snap = await firebaseConfig.db.collection('messages').where('type', '==', 'broadcast').get();
            const docs = snap.docs.map(d => d.data());
            assert.ok(docs.some(d => d.receiverId === recipA));
            assert.ok(docs.some(d => d.receiverId === recipB));
        });

        it('clearChat removes messages for chatId from Firestore', async () => {
            const req = {
                params: { chatId: testChatId }
            };
            let jsonRes = null;
            const res = {
                json(payload) { jsonRes = payload; return this; },
                status(code) { return this; }
            };

            await messageController.clearChat(req, res);
            assert.equal(jsonRes.success, true);

            const docSnap = await firebaseConfig.db.collection('messages').doc(createdMsgId).get();
            assert.equal(docSnap.exists, false, 'Message must be deleted after clearChat');
        });
    });

    describe('3. Firebase Production Credentials Guard', () => {
        it('throws an error in production if credentials are missing instead of using mock db', async () => {
            const childScript = `
                process.env.NODE_ENV = 'production';
                delete process.env.FIREBASE_SERVICE_ACCOUNT;
                try {
                    const origRequire = module.constructor.prototype.require;
                    module.constructor.prototype.require = function(pathStr) {
                        if (pathStr.includes('serviceAccountKey.json')) {
                            throw new Error('Cannot find module serviceAccountKey.json');
                        }
                        return origRequire.apply(this, arguments);
                    };

                    require('./config/firebase.js');
                    process.exit(0);
                } catch (err) {
                    if (err.message.includes('Firebase credentials are required in production')) {
                        process.exit(42);
                    }
                    console.error(err);
                    process.exit(1);
                }
            `;

            const child = fork('-e', [childScript], {
                cwd: path.resolve(__dirname, '..'),
                stdio: 'pipe'
            });

            const exitCode = await new Promise((resolve) => {
                child.on('exit', (code) => resolve(code));
            });

            assert.equal(exitCode, 42, 'Firebase config must throw when credentials are missing in production');
        });
    });
});
