import makeWASocket, { DisconnectReason } from "baileys";
import P from 'pino';
import QRCode from 'qrcode';
import { config } from "dotenv";
import useDynamoDBAuthState from "./usedynamodb.js"; // Your DynamoDB auth state handler
import redis from "./redis.js"; // Your Redis client (e.g., ioredis)
import express from 'express';

config({ path: '.env' });

const qrStore = new Map(); // In-memory for temporary QR codes
const socketStore = new Map(); // In-memory for active WebSockets per instance
const app = express();
app.use(express.json());

// Distributed session metadata in Redis
const sessions = {
    get: async (sessionId) => {
        const data = await redis.get(`wa:session:${sessionId}`);
        return data ? JSON.parse(data) : null;
    },
    set: async (sessionId, metadata) => {
        await redis.set(`wa:session:${sessionId}`, JSON.stringify(metadata));
    },
    add: async (sessionId) => {
        await redis.sadd('wa:active_sessions', sessionId); // Track active sessions
    },
    remove: async (sessionId) => {
        await redis.srem('wa:active_sessions', sessionId);
    }
};

// Claim session with distributed lock
async function claimSession(sessionId, instanceId = process.env.INSTANCE_ID || 'default') {
    const lockKey = `session:${sessionId}:lock`;
    const acquired = await redis.set(lockKey, instanceId, 'NX', 'EX', 60); // Lock for 60s
    if (acquired === 'OK') {
        // Renew lock periodically
        const interval = setInterval(async () => {
            await redis.expire(lockKey, 60);
        }, 30000); // Renew every 30s
        socketStore.set(sessionId, { lockInterval: interval });
        return true;
    }
    return false;
}

// Release session lock
async function releaseSession(sessionId) {
    const lockKey = `session:${sessionId}:lock`;
    await redis.del(lockKey);
    const session = socketStore.get(sessionId);
    if (session && session.lockInterval) {
        clearInterval(session.lockInterval);
    }
    socketStore.delete(sessionId);
}

async function connectionLogic(userId) {
    try {
        if (!(await claimSession(userId))) {
            console.log(`Session ${userId} already claimed by another instance`);
            return null;
        }

        const { state, saveCreds } = await useDynamoDBAuthState("WhatsAppAuth", userId);
        const sock = makeWASocket({
            auth: state,
            logger: P({ level: 'debug' }), // Debug logging
            connectTimeoutMs: 60_000
        });

        socketStore.set(userId, { sock, status: 'connecting' });
        await sessions.set(userId, { status: 'connecting', owner: process.env.INSTANCE_ID || 'default' });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (connection === 'open') {
                console.log(`✅ Successfully logged in for ${userId}!`);
                socketStore.set(userId, { sock, status: 'connected' });
                await sessions.set(userId, { status: 'connected', owner: process.env.INSTANCE_ID });
                await sessions.add(userId); // Add to active sessions
            }

            if (qr) {
                const qrDataUrl = await QRCode.toDataURL(qr);
                qrStore.set(userId, qrDataUrl);
                console.log(`QR for ${userId}:`, await QRCode.toString(qr, { type: 'terminal', small: true }));
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                if (statusCode !== DisconnectReason.loggedOut) {
                    console.log(`⚠️ Connection closed for ${userId}. Reconnecting…`);
                    socketStore.delete(userId);
                    await releaseSession(userId);
                    connectionLogic(userId); // Retry
                } else {
                    console.log(`❌ Logged out for ${userId}. Need new QR scan.`);
                    await sessions.set(userId, { status: 'logged_out' });
                    await sessions.remove(userId);
                    await releaseSession(userId);
                }
            }
        });

        sock.ev.on('messages.upsert', async (m) => {
            console.log(`📩 New message for ${userId}:`, JSON.stringify(m, null, 2));
            const msg = m.messages[0];
            if (!msg.key.fromMe) {
                const sender = msg.key.remoteJid;
                const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
                // Example: Auto-reply (uncomment to enable)
                // await sock.sendMessage(sender, { text: `Got your message: ${text}` });
            }
        });

        return sock;
    } catch (error) {
        console.error(`Error in connectionLogic for ${userId}:`, error);
        await releaseSession(userId);
        await sessions.set(userId, { status: 'error' });
        return null;
    }
}

async function getGroups(sessionId) {
    try {
        let sockData = socketStore.get(sessionId);
        let sock = sockData?.sock;

        if (!sock) {
            if (!(await claimSession(sessionId))) {
                throw new Error(`Session ${sessionId} is locked by another instance`);
            }
            const { state, saveCreds } = await useDynamoDBAuthState("WhatsAppAuth", sessionId);
            sock = makeWASocket({
                auth: state,
                logger: P({ level: 'debug' }),
                connectTimeoutMs: 60_000
            });
            sock.ev.on('creds.update', saveCreds);
            socketStore.set(sessionId, { sock, status: 'connecting' });
            await sessions.set(sessionId, { status: 'connecting', owner: process.env.INSTANCE_ID });
        }

        if (!sock.user) {
            throw new Error(`No active session for ${sessionId}`);
        }
        console.log(`Fetching groups for session: ${sessionId}`);
        const groups = await sock.groupFetchAllParticipating();
        return Object.values(groups).filter(g => g.id.endsWith('@g.us'));
    } catch (error) {
        console.error(`Error in getGroups for ${sessionId}:`, error);
        throw error;
    }
}

// REST API Endpoints
app.post('/send/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { to, message } = req.body;
        let sockData = socketStore.get(sessionId);
        let sock = sockData?.sock;

        if (!sock) {
            sock = await connectionLogic(sessionId);
            if (!sock) {
                return res.status(400).json({ error: `Session ${sessionId} is locked or unavailable` });
            }
        }

        await sock.sendMessage(to, { text: message });
        res.json({ status: 'sent' });
    } catch (error) {
        console.error(`Error sending message for ${req.params.sessionId}:`, error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

app.get('/groups/:sessionId', async (req, res) => {
    try {
        const groups = await getGroups(req.params.sessionId);
        res.json(groups);
    } catch (error) {
        console.error(`Error fetching groups for ${req.params.sessionId}:`, error);
        res.status(500).json({ error: 'Failed to fetch groups' });
    }
});

app.get('/qr/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const qr = qrStore.get(sessionId);
        if (!qr) {
            return res.status(404).json({ error: 'No QR code available' });
        }
        res.json({ qr });
    } catch (error) {
        console.error(`Error fetching QR for ${req.params.sessionId}:`, error);
        res.status(500).json({ error: 'Failed to fetch QR' });
    }
});

async function init() {
    try {
        const sessionIds = await redis.smembers('wa:active_sessions');
        console.log('Active sessions:', sessionIds);

        for (const sessionId of sessionIds) {
            if (await claimSession(sessionId)) {
                console.log(`Claimed session ${sessionId}`);
                await connectionLogic(sessionId);
            } else {
                console.log(`Session ${sessionId} already claimed`);
            }
        }
    } catch (error) {
        console.error('Error in init:', error);
    }
}

// Start server and initialize sessions
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`API server running on port ${PORT}`);
    await init();
});

export { connectionLogic, getGroups, qrStore, init };