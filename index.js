import makeWASocket, { useMultiFileAuthState , DisconnectReason } from "baileys";
import P from 'pino';
import QRCode from 'qrcode';
import { config } from "dotenv";
import useMongoDBAuthState from "./db.js";
import { MongoClient } from "mongodb";

config({
    path: '.env'
});

async function connectionLogic(userId) {


    const mongoClient = new MongoClient(process.env.MONGO_URI);
    await mongoClient.connect();

    // const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");

    const collection = mongoClient.db('whatsapp_api').collection('botInfo');


    const { state , saveCreds} = await useMongoDBAuthState(collection , userId);

    const sock = makeWASocket({
        auth: state,
        logger: P()
    }); 

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (connection === 'open') {
            console.log("✅ Successfully logged in!");

            await sock.sendMessage("919620484935@s.whatsapp.net", { text: "Hello from Baileys 🚀" })
        }

        if (qr) {
            console.log("the request came to qr state");
            console.log(await QRCode.toString(qr, { type: 'terminal', small: true }));
        }

        if (connection === 'close' && (lastDisconnect?.error)?.output?.statusCode === DisconnectReason.restartRequired) {
            connectionLogic(userId);
        }
    });

    // Send a message

    sock.ev.on("messages.upsert", async (m) => {
        console.log("📩 New message received:", JSON.stringify(m, null, 2));

        const msg = m.messages[0];
        if (!msg.key.fromMe) {  // ignore messages you sent yourself
            const sender = msg.key.remoteJid;
            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;

            console.log("👤 From:", sender);
            console.log("💬 Message:", text);

            // Example: Auto-reply
            await sock.sendMessage(sender, { text: "Got your message ✅" });
        }
    });

}

const userId = 'pavan-device-1'

connectionLogic(userId);