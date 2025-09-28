import makeWASocket, { DisconnectReason , BufferJSON } from "baileys";
import P from 'pino';
import QRCode from 'qrcode';
import { config } from "dotenv";
import useMongoDBAuthState from "./db.js";
import useDynamoDBAuthState from "./usedynamodb.js";
import { MongoClient } from "mongodb";
import redis, { clearState } from "./redis.js";


config({
    path: '.env'
});

const qrStore = new Map();

const sessions = {
    get: async (sessionId) => {
        const data = await redis.get(sessionId);
        return data ? JSON.parse(data, BufferJSON.reviver) : null;
    },
    set: async (sessionId, userSock) => {
        await redis.set(sessionId, JSON.stringify(userSock, BufferJSON.replacer));
    }
};


async function claimSession(sessionId) {
    const lockKey = `session:${sessionId}:lock`;
    const acquired = await redis.set(lockKey, 'locked', 'NX', 'EX', 60); // Lock for 60s
    return acquired === 'OK';
}

async function connectionLogic(userId) {
    const { state, saveCreds } = await useDynamoDBAuthState("WhatsAppAuth", userId);

    const sock = makeWASocket({
        auth: state,
        logger: P(),
        connectTimeoutMs: 60_000
    });

    sock.ev.on('creds.update', saveCreds);

    sessions.set(userId, sock.auth);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (connection === 'open') {
            console.log("✅ Successfully logged in!");
            sessions.set(userId, sock.auth);
        }

        if (qr) {

            const qrDataUrl = await QRCode.toDataURL(qr);
            qrStore.set(userId, qrDataUrl);

            console.log(await QRCode.toString(qr, { type: 'terminal', small: true }));
            sessions.set(userId, sock.auth);
        }

        if (connection === "close") {
            const statusCode = (lastDisconnect?.error)?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log("⚠️ Connection closed. Reconnecting…");
                connectionLogic(userId);
            } else {
                console.log("❌ Logged out. Need new QR scan.");
                await redis.set(`wa:status:${userId}`, "logged_out");
            }
        }
    });

    // Send a message
    sock.ev.on("messages.upsert", async (m) => {
        console.log("📩 New message received:", JSON.stringify(m, null, 2));

        const msg = m.messages[0];
        if (!msg.key.fromMe) {  // ignore messages you sent yourself
            const sender = msg.key.remoteJid;
            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;

            // // Example: Auto-reply
            // await sock.sendMessage(sender, { text: "Got your message " });
        }
    });

    return sock;
}


const getGroups = async (sessionId) => {
    // load auth state from DynamoDB (or MongoDB)

    const { state, saveCreds } = await useDynamoDBAuthState("WhatsAppAuth", sessionId);

    const localsock = makeWASocket({
        auth: state,
        logger: P(),
        connectTimeoutMs: 60_000
    });

    if (!localsock) {
        throw new Error("No active session");
    }
    console.log("Fetching groups for session:", sessionId);
    console.log("The sock object is ", localsock);
    return (await localsock.groupFetchAllParticipating()).filter(g => g.id.endsWith("@g.us"));
};


// connectionLogic("test_user_2");

const init = async () => {
    const sessions = await redis.keys("*");

    console.log("sessions from redis:", sessions);
    for (const sessionId of sessions) {
        connectionLogic(sessionId);
    }

}

export {
    connectionLogic,
    getGroups,
    qrStore,
    init,
};