import express from 'express';
import cors from 'cors';
import { connectionLogic} from './whatsaap.js';
import dynamodbroutes from './dynamodbroutes.js';
import grouproutes from './groupRoute.js';

const app = express();
app.use(cors());
app.use(express.json());

app.use(dynamodbroutes);

app.use(grouproutes);

app.post('/session/add', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: "userId required" });
        await connectionLogic(userId, res);
    } catch (error) {
        console.error("Error in /session/add:", error);
        res.status(500).json({ error: 'internal-error', details: error.message });
    }
});

// // Step 1: Start session
// app.post('/session', (req, res) => {
//     const { userId } = req.body;
//     if (!userId) return res.status(400).json({ error: "userId required" });

//     connectionLogic(userId);
//     res.json({ message: "Session starting...", userId });
// });

// // Step 2: Get QR separately
// app.get('/session/qr/:userId', (req, res) => {
//     const { userId } = req.params;
//     const qr = qrStore.get(userId);

//     if (!qr) {
//         return res.status(404).json({ error: "QR not found yet or already scanned" });
//     }

//     res.json({ userId, qr });
// });


app.get("/health", (req, res) => {
    res.status(200).json({ status: "OK" });
});


app.listen(8080, () => {
    console.log("🚀 Server listening on 8080");
});


