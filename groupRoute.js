import { Router } from 'express';
import {fetchGroups } from './whatsaap.js';

const router = Router();

router.get('/groups', async (req, res) => {
    try {
        const groups = await fetchGroups(req.query.sessionId);
        res.json(groups);
    }

    catch (err) {
        console.error("Error in /groups:", err);
        res.status(500).json({ ok: false, error: 'internal-error', details: err.message });
    }
});


export default router;