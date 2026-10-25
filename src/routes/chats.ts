import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../database.js';
import { authenticateToken, AuthRequest } from './auth.js';
import { Chat, Message, User } from '../types.js';

export const chatsRouter = Router();

// 1. Get All Active Chats for the Logged-in User
chatsRouter.get('/', authenticateToken, (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  // Fetch all chats where user is participant
  const rawChats = db.prepare(`
    SELECT c.id, c.type, c.group_id, c.last_message_at, c.created_at,
           g.name as group_name, g.avatar_url as group_avatar, g.description as group_description
    FROM chats c
    JOIN chat_participants cp ON cp.chat_id = c.id
    LEFT JOIN groups g ON g.id = c.group_id
    WHERE cp.user_id = ?
    ORDER BY c.last_message_at DESC
  `).all(userId) as any[];

  const chats: Chat[] = rawChats.map((c) => {
    // Get last message in this chat
    const lastMsg = db.prepare(`
      SELECT m.*, u.display_name as sender_name
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.chat_id = ?
      ORDER BY m.sent_at DESC
      LIMIT 1
    `).get(c.id) as any;

    // Get unread count
    const unreadCount = db.prepare(`
      SELECT COUNT(*) as count 
      FROM messages 
      WHERE chat_id = ? AND sender_id != ? AND status != 'READ'
    `).get(c.id, userId) as { count: number };

    // If it's a DIRECT chat, find the OTHER user's details
    let chatName = c.group_name;
    let chatAvatar = c.group_avatar;
    let otherParticipant: User | undefined;

    if (c.type === 'DIRECT') {
      const otherUser = db.prepare(`
        SELECT u.* FROM users u
        JOIN chat_participants cp ON cp.user_id = u.id
        WHERE cp.chat_id = ? AND cp.user_id != ?
      `).get(c.id, userId) as User | undefined;

      if (otherUser) {
        chatName = otherUser.display_name;
        chatAvatar = otherUser.avatar_url;
        otherParticipant = otherUser;
      }
    }

    return {
      id: c.id,
      type: c.type,
      group_id: c.group_id,
      name: chatName || 'Chat',
      avatar_url: chatAvatar,
      last_message_at: c.last_message_at,
      created_at: c.created_at,
      last_message: lastMsg ? lastMsg.content : null,
      last_message_status: lastMsg ? lastMsg.status : null,
      unread_count: unreadCount.count,
      participants: otherParticipant ? [otherParticipant] : []
    };
  });

  res.json({ chats });
});

// 2. Get Messages for a Specific Chat
chatsRouter.get('/:chatId/messages', authenticateToken, (req: AuthRequest, res: Response) => {
  const { chatId } = req.params;
  const userId = req.user!.id;

  // Verify participant
  const isParticipant = db.prepare(`
    SELECT 1 FROM chat_participants WHERE chat_id = ? AND user_id = ?
  `).get(chatId, userId);

  if (!isParticipant) {
    return res.status(403).json({ error: 'You are not a participant in this chat' });
  }

  const messages = db.prepare(`
    SELECT m.*, u.display_name as sender_name, u.avatar_url as sender_avatar
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.chat_id = ?
    ORDER BY m.sent_at ASC
  `).all(chatId) as any[];

  res.json({ messages });
});

// 3. Start or Get Direct 1-on-1 Chat with another User
chatsRouter.post('/direct', authenticateToken, (req: AuthRequest, res: Response) => {
  const currentUserId = req.user!.id;
  const { target_user_id } = req.body;

  if (!target_user_id || target_user_id === currentUserId) {
    return res.status(400).json({ error: 'Valid target user is required' });
  }

  // Check if target user exists
  const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(target_user_id) as User | undefined;
  if (!targetUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Check if direct chat already exists
  const existingChat = db.prepare(`
    SELECT c.id FROM chats c
    JOIN chat_participants cp1 ON cp1.chat_id = c.id AND cp1.user_id = ?
    JOIN chat_participants cp2 ON cp2.chat_id = c.id AND cp2.user_id = ?
    WHERE c.type = 'DIRECT'
    LIMIT 1
  `).get(currentUserId, target_user_id) as { id: string } | undefined;

  if (existingChat) {
    return res.json({ chat_id: existingChat.id, target_user: targetUser });
  }

  // Create new direct chat
  const newChatId = 'chat_' + uuidv4().substring(0, 12);
  const now = new Date().toISOString();

  const insertChat = db.transaction(() => {
    db.prepare('INSERT INTO chats (id, type, created_at, last_message_at) VALUES (?, ?, ?, ?)').run(newChatId, 'DIRECT', now, now);
    db.prepare('INSERT INTO chat_participants (id, chat_id, user_id) VALUES (?, ?, ?)').run(uuidv4(), newChatId, currentUserId);
    db.prepare('INSERT INTO chat_participants (id, chat_id, user_id) VALUES (?, ?, ?)').run(uuidv4(), newChatId, target_user_id);
  });

  insertChat();

  res.status(201).json({
    chat_id: newChatId,
    target_user: targetUser
  });
});
