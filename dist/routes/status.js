import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../database.js';
import { authenticateToken } from './auth.js';
export const statusRouter = Router();
// 1. Get All Active Status Updates (within 24 hours)
statusRouter.get('/', authenticateToken, (req, res) => {
    const currentUserId = req.user.id;
    // Fetch non-expired statuses
    const rawStatuses = db.prepare(`
    SELECT s.*, u.display_name, u.avatar_url, u.username
    FROM statuses s
    JOIN users u ON u.id = s.user_id
    WHERE datetime(s.expires_at) > datetime('now')
    ORDER BY s.created_at DESC
  `).all();
    // Separate my status vs recent updates from contacts
    const myStatus = rawStatuses.filter(s => s.user_id === currentUserId);
    const otherStatuses = rawStatuses.filter(s => s.user_id !== currentUserId);
    res.json({
        my_status: myStatus,
        recent_updates: otherStatuses
    });
});
// 2. Post a New Status Update
statusRouter.post('/', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const { content, media_url } = req.body;
    if (!content && !media_url) {
        return res.status(400).json({ error: 'Status content or media is required' });
    }
    const statusId = 'status_' + uuidv4().substring(0, 10);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
    INSERT INTO statuses (id, user_id, content, media_url, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(statusId, userId, content || '', media_url || null, now.toISOString(), expiresAt);
    const newStatus = db.prepare(`
    SELECT s.*, u.display_name, u.avatar_url, u.username
    FROM statuses s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ?
  `).get(statusId);
    res.status(201).json({
        success: true,
        status: newStatus
    });
});
