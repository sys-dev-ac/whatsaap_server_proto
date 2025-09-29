import makeWASocket, { DisconnectReason } from "baileys";
import P from 'pino';
import QRCode from 'qrcode';
import { config } from "dotenv";
import useMongoDBAuthState from "./db.js";
import useDynamoDBAuthState from "./usedynamodb.js";
import { MongoClient } from "mongodb";
import redis from "./redis.js";

config({
    path: '.env'
});

const qrStore = new Map();
const sessions = new Map();



async function connectionLogic(userId) {


    // const mongoClient = new MongoClient(process.env.MONGO_URI);
    // await mongoClient.connect();

    // const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");

    // const collection = mongoClient.db('whatsapp_api').collection('botInfo');


    // const { state, saveCreds } = await useMongoDBAuthState(collection, userId);

    const { state, saveCreds } = await useDynamoDBAuthState("WhatsAppAuth", userId);

    const sock = makeWASocket({
        auth: state,
        logger: P(),
        connectTimeoutMs: 60_000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (connection === 'open') {
            console.log("✅ Successfully logged in!");
            sessions.set(userId, sock);
            await redis.set(userId, JSON.stringify({ sock }));
        }

        if (qr) {

            const qrDataUrl = await QRCode.toDataURL(qr);
            qrStore.set(userId, qrDataUrl);

            console.log(await QRCode.toString(qr, { type: 'terminal', small: true }));
            sessions.set(userId, sock);

            return;
        }

        if (connection === "close") {
            const statusCode = (lastDisconnect?.error)?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log("⚠️ Connection closed. Reconnecting…");
                connectionLogic(userId);
            } else {
                console.log("❌ Logged out. Need new QR scan.");
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

}


const fetchGroups = async (userId) => {
    const session = sessions.get(userId);
    if (!session) {
        throw new Error(`No active session for userId: ${userId}`);
    }
    const groups = await session.groupFetchAllParticipating();
    return Object.values(groups);
}

const init = async () => {
    // Any global initialization can go here
    console.log("Initialization complete.");
}

// connectionLogic("test_user_1");

export {
    connectionLogic,
    fetchGroups,
    init,
};