import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../database.js';
import { authenticateToken, AuthRequest } from './auth.js';

export const groupsRouter = Router();

// 1. Create a "Chaukdi" Group / Squad
groupsRouter.post('/', authenticateToken, (req: AuthRequest, res: Response) => {
  const creatorId = req.user!.id;
  const { name, description, member_ids, avatar_url } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'Chaukdi group name is required' });
  }

  const groupId = 'grp_' + uuidv4().substring(0, 10);
  const chatId = 'chat_' + groupId;
  const now = new Date().toISOString();

  // Combine creator and members (unique)
  const allMembers = Array.from(new Set([creatorId, ...(Array.isArray(member_ids) ? member_ids : [])]));

  const createGroupTx = db.transaction(() => {
    // 1. Insert into groups
    db.prepare(`
      INSERT INTO groups (id, name, description, avatar_url, creator_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      groupId,
      name.trim(),
      description || '',
      avatar_url || `https://api.dicebear.com/7.x/identicon/svg?seed=${groupId}`,
      creatorId,
      now
    );

    // 2. Insert into chats
    db.prepare(`
      INSERT INTO chats (id, type, group_id, last_message_at, created_at)
      VALUES (?, 'GROUP', ?, ?, ?)
    `).run(chatId, groupId, now, now);

    // 3. Add members & chat participants
    const insertMember = db.prepare(`
      INSERT INTO group_members (id, group_id, user_id, role, joined_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertParticipant = db.prepare(`
      INSERT INTO chat_participants (id, chat_id, user_id, joined_at)
      VALUES (?, ?, ?, ?)
    `);

    for (const uid of allMembers) {
      const role = uid === creatorId ? 'ADMIN' : 'MEMBER';
      insertMember.run(uuidv4(), groupId, uid, role, now);
      insertParticipant.run(uuidv4(), chatId, uid, now);
    }

    // 4. System creation message
    db.prepare(`
      INSERT INTO messages (id, chat_id, sender_id, content, status, sent_at)
      VALUES (?, ?, ?, ?, 'SENT', ?)
    `).run(
      uuidv4(),
      chatId,
      creatorId,
      `🎉 ${req.user!.display_name} ne nai Chaukdi "${name.trim()}" banayi hai. Aao, baithak shuru karein!`,
      now
    );
  });

  createGroupTx();

  res.status(201).json({
    success: true,
    group_id: groupId,
    chat_id: chatId,
    name: name.trim()
  });
});

// 2. Get Group Details & Members
groupsRouter.get('/:groupId', authenticateToken, (req: AuthRequest, res: Response) => {
  const { groupId } = req.params;
  const userId = req.user!.id;

  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId) as any;
  if (!group) {
    return res.status(404).json({ error: 'Group not found' });
  }

  // Get members
  const members = db.prepare(`
    SELECT gm.role, gm.joined_at, u.id, u.display_name, u.username, u.avatar_url, u.about, u.is_online, u.last_seen
    FROM group_members gm
    JOIN users u ON u.id = gm.user_id
    WHERE gm.group_id = ?
    ORDER BY gm.role DESC, u.display_name ASC
  `).all(groupId);

  res.json({ group, members });
});
