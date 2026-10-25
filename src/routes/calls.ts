import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../database.js';
import { syncUpsert } from '../supabase.js';
import { authenticateToken, AuthRequest } from './auth.js';

export const callsRouter = Router();

// 1. Get Call History for Logged-in User
callsRouter.get('/', authenticateToken, (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  const calls = db.prepare(`
    SELECT c.*,
           caller.display_name as caller_name, caller.avatar_url as caller_avatar,
           receiver.display_name as receiver_name, receiver.avatar_url as receiver_avatar
    FROM calls c
    JOIN users caller ON caller.id = c.caller_id
    JOIN users receiver ON receiver.id = c.receiver_id
    WHERE c.caller_id = ? OR c.receiver_id = ?
    ORDER BY c.created_at DESC
    LIMIT 50
  `).all(userId, userId);

  res.json({ calls });
});

// 2. Log a Call
callsRouter.post('/', authenticateToken, (req: AuthRequest, res: Response) => {
  const callerId = req.user!.id;
  const { receiver_id, call_type = 'AUDIO', status = 'COMPLETED', duration_seconds = 0 } = req.body;

  if (!receiver_id) {
    return res.status(400).json({ error: 'Receiver is required' });
  }

  const callId = 'call_' + uuidv4().substring(0, 10);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO calls (id, caller_id, receiver_id, call_type, status, duration_seconds, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(callId, callerId, receiver_id, call_type, status, duration_seconds, now);

  syncUpsert('calls', {
    id: callId,
    caller_id: callerId,
    receiver_id: receiver_id,
    call_type: call_type,
    status: status,
    duration_seconds: duration_seconds,
    created_at: now
  });

  res.status(201).json({ success: true, call_id: callId });
});
