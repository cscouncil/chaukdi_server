import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { db } from './database.js';
import { syncUpsert } from './supabase.js';
const JWT_SECRET = process.env.JWT_SECRET || 'chaukdi_sovereign_secret_key_2026';
// Map of userId -> Set of active socket IDs
const userSocketsMap = new Map();
export function setupSocketIO(io) {
    // Authentication Middleware for Sockets
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
        if (!token) {
            return next(new Error('Authentication token required'));
        }
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.id);
            if (!user) {
                return next(new Error('User not found'));
            }
            socket.user = user;
            next();
        }
        catch (err) {
            return next(new Error('Invalid token'));
        }
    });
    io.on('connection', (socket) => {
        const user = socket.user;
        const userId = user.id;
        // Track active socket
        if (!userSocketsMap.has(userId)) {
            userSocketsMap.set(userId, new Set());
        }
        userSocketsMap.get(userId).add(socket.id);
        // Update user online status in DB
        const now = new Date().toISOString();
        db.prepare('UPDATE users SET is_online = 1, last_seen = ? WHERE id = ?').run(now, userId);
        syncUpsert('users', { id: userId, is_online: 1, last_seen: now });
        // Broadcast online status to all connected users
        io.emit('user_presence', {
            user_id: userId,
            is_online: true,
            last_seen: now
        });
        console.log(`🟢 [Chaukdi Socket] User connected: ${user.display_name} (${userId})`);
        // Auto-join all user's chat rooms
        const userChats = db.prepare('SELECT chat_id FROM chat_participants WHERE user_id = ?').all(userId);
        userChats.forEach(({ chat_id }) => {
            socket.join(chat_id);
        });
        // 1. Send Message Event (WhatsApp Lifecycle Phase 1)
        socket.on('send_message', (payload, callback) => {
            const { chat_id, content, media_type = 'TEXT', media_url = null, temp_id } = payload;
            if (!chat_id || !content)
                return;
            const messageId = 'msg_' + uuidv4().substring(0, 12);
            const sentAt = new Date().toISOString();
            // Check other participants in this chat to see if any are online right now
            const participants = db.prepare('SELECT user_id FROM chat_participants WHERE chat_id = ? AND user_id != ?').all(chat_id, userId);
            const anyOtherOnline = participants.some(p => {
                const sockets = userSocketsMap.get(p.user_id);
                return sockets && sockets.size > 0;
            });
            // Initial status: DELIVERED if another user is actively online, else SENT
            const initialStatus = anyOtherOnline ? 'DELIVERED' : 'SENT';
            const deliveredAt = anyOtherOnline ? sentAt : null;
            // Save to database
            db.prepare(`
        INSERT INTO messages (id, chat_id, sender_id, content, media_type, media_url, status, sent_at, delivered_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(messageId, chat_id, userId, content, media_type, media_url, initialStatus, sentAt, deliveredAt);
            // Update chat last_message_at
            db.prepare('UPDATE chats SET last_message_at = ? WHERE id = ?').run(sentAt, chat_id);
            // Realtime Cloud Persistence
            syncUpsert('messages', {
                id: messageId,
                chat_id,
                sender_id: userId,
                content,
                media_type,
                media_url,
                status: initialStatus,
                sent_at: sentAt,
                delivered_at: deliveredAt
            });
            syncUpsert('chats', { id: chat_id, last_message_at: sentAt });
            const messageData = {
                id: messageId,
                chat_id,
                sender_id: userId,
                content,
                media_type,
                media_url,
                status: initialStatus,
                sent_at: sentAt,
                delivered_at: deliveredAt,
                read_at: null,
                sender: user
            };
            // 1. Single/Double Tick Ack to Sender
            if (callback) {
                callback({ success: true, message: messageData, temp_id });
            }
            // 2. Broadcast message to everyone in the chat room (except sender)
            socket.to(chat_id).emit('new_message', messageData);
            // 3. AI Bot Auto-reply Handler (If chatting with Chaukdi AI)
            const hasAiBot = participants.some(p => p.user_id === 'u_chaukdi_ai');
            if (hasAiBot) {
                // Send typing indicator from AI Bot
                setTimeout(() => {
                    socket.emit('user_typing', {
                        chat_id,
                        user_id: 'u_chaukdi_ai',
                        display_name: 'Chaukdi AI 🤖',
                        is_typing: true
                    });
                    // Generate response after 1.5s
                    setTimeout(() => {
                        const aiMsgId = 'msg_' + uuidv4().substring(0, 12);
                        const aiSentAt = new Date().toISOString();
                        let replyText = 'Namaste! Mai hu Chaukdi AI 🇮🇳. Aapka sovereign digital saathi!';
                        const lower = content.toLowerCase();
                        if (lower.includes('name') || lower.includes('naam')) {
                            replyText = 'Mera naam Chaukdi AI hai! Mai Bharat ke apne private messenger "Chaukdi" ka personal assistant hu. Aapka kya haal hai? 😊';
                        }
                        else if (lower.includes('hey') || lower.includes('hello') || lower.includes('hi')) {
                            replyText = 'Hello ji! Chaukdi pe aapka swagat hai. Kahiye, aaj kisse baatcheet chal rahi hai?';
                        }
                        else if (lower.includes('kaise') || lower.includes('haal')) {
                            replyText = 'Hum ekdum badhiya hain! Aap batao, Chaukdi ka ye desi messenger kaisa laga? 🚀';
                        }
                        else {
                            replyText = `Aapne pucha: "${content}" — Chaukdi pe aapka har message 100% encrypted aur safe hai! Batayein, mai aapki kya madad karu?`;
                        }
                        db.prepare(`
              INSERT INTO messages (id, chat_id, sender_id, content, status, sent_at, delivered_at)
              VALUES (?, ?, 'u_chaukdi_ai', ?, 'DELIVERED', ?, ?)
            `).run(aiMsgId, chat_id, replyText, aiSentAt, aiSentAt);
                        db.prepare('UPDATE chats SET last_message_at = ? WHERE id = ?').run(aiSentAt, chat_id);
                        syncUpsert('messages', {
                            id: aiMsgId,
                            chat_id,
                            sender_id: 'u_chaukdi_ai',
                            content: replyText,
                            status: 'DELIVERED',
                            sent_at: aiSentAt,
                            delivered_at: aiSentAt
                        });
                        syncUpsert('chats', { id: chat_id, last_message_at: aiSentAt });
                        socket.emit('user_typing', {
                            chat_id,
                            user_id: 'u_chaukdi_ai',
                            display_name: 'Chaukdi AI 🤖',
                            is_typing: false
                        });
                        const aiMessageObj = {
                            id: aiMsgId,
                            chat_id,
                            sender_id: 'u_chaukdi_ai',
                            content: replyText,
                            media_type: 'TEXT',
                            media_url: null,
                            status: 'DELIVERED',
                            sent_at: aiSentAt,
                            delivered_at: aiSentAt,
                            read_at: null,
                            sender: {
                                id: 'u_chaukdi_ai',
                                display_name: 'Chaukdi AI 🤖',
                                phone_number: '+910000000000',
                                username: 'chaukdi_ai',
                                avatar_url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150',
                                about: 'Bharat ka apna AI Dost.',
                                role: 'USER',
                                is_online: 1,
                                last_seen: aiSentAt,
                                created_at: aiSentAt
                            }
                        };
                        socket.emit('new_message', aiMessageObj);
                    }, 1500);
                }, 600);
            }
        });
        // 2. Message Read / Blue Tick Event
        socket.on('mark_as_read', ({ chat_id }) => {
            if (!chat_id)
                return;
            const readAt = new Date().toISOString();
            // Update all unread messages from other users in this chat to READ
            db.prepare(`
        UPDATE messages 
        SET status = 'READ', read_at = ? 
        WHERE chat_id = ? AND sender_id != ? AND status != 'READ'
      `).run(readAt, chat_id, userId);
            // Notify the chat room that messages were read (Turns double ticks to BLUE ticks ✓✓)
            io.to(chat_id).emit('messages_read_update', {
                chat_id,
                read_by_user_id: userId,
                read_at: readAt
            });
        });
        // 3. Realtime Typing Indicator
        socket.on('typing_start', ({ chat_id }) => {
            socket.to(chat_id).emit('user_typing', {
                chat_id,
                user_id: userId,
                display_name: user.display_name,
                is_typing: true
            });
        });
        socket.on('typing_stop', ({ chat_id }) => {
            socket.to(chat_id).emit('user_typing', {
                chat_id,
                user_id: userId,
                display_name: user.display_name,
                is_typing: false
            });
        });
        // 4. Real-time VoIP Call Signaling (Voice & Video Calls)
        socket.on('start_call', (data) => {
            const { receiver_id, call_type = 'AUDIO' } = data;
            console.log(`📞 [Chaukdi Call] ${user.display_name} calling ${receiver_id} (${call_type})`);
            const receiverSockets = userSocketsMap.get(receiver_id);
            const callId = 'call_' + uuidv4().substring(0, 10);
            const startedAt = new Date().toISOString();
            if (!receiverSockets || receiverSockets.size === 0) {
                console.log(`⚠️ [Chaukdi Call] Receiver ${receiver_id} is offline`);
                socket.emit('call_failed', { reason: 'User is currently offline' });
                // Record Missed Call in SQLite DB
                db.prepare(`
          INSERT INTO calls (id, caller_id, receiver_id, call_type, status, duration_seconds, created_at)
          VALUES (?, ?, ?, ?, 'MISSED', 0, ?)
        `).run(callId, userId, receiver_id, call_type, startedAt);
                syncUpsert('calls', {
                    id: callId,
                    caller_id: userId,
                    receiver_id,
                    call_type,
                    status: 'MISSED',
                    duration_seconds: 0,
                    created_at: startedAt
                });
                return;
            }
            const callPayload = {
                call_id: callId,
                caller_id: userId,
                caller_name: user.display_name,
                caller_avatar: user.avatar_url,
                caller_phone: user.phone_number,
                call_type,
                started_at: startedAt
            };
            // Notify caller that phone is ringing
            socket.emit('call_ringing', { call_id: callId, receiver_id });
            // Forward incoming call to all active sockets of receiver
            receiverSockets.forEach(sockId => {
                io.to(sockId).emit('incoming_call', callPayload);
            });
        });
        socket.on('accept_call', (data) => {
            const { caller_id, call_id } = data;
            console.log(`✅ [Chaukdi Call] Call ${call_id} accepted by ${user.display_name}`);
            const callerSockets = userSocketsMap.get(caller_id);
            if (callerSockets) {
                callerSockets.forEach(sockId => {
                    io.to(sockId).emit('call_accepted', {
                        call_id,
                        receiver_id: userId,
                        receiver_name: user.display_name,
                        receiver_avatar: user.avatar_url
                    });
                });
            }
        });
        socket.on('reject_call', (data) => {
            const { caller_id, call_id, reason = 'declined' } = data;
            console.log(`❌ [Chaukdi Call] Call ${call_id} rejected by ${user.display_name}`);
            const callerSockets = userSocketsMap.get(caller_id);
            if (callerSockets) {
                callerSockets.forEach(sockId => {
                    io.to(sockId).emit('call_rejected', { call_id, reason });
                });
            }
            // Record Declined Call in DB
            const now = new Date().toISOString();
            const recordedCallId = call_id || ('call_' + uuidv4().substring(0, 10));
            db.prepare(`
        INSERT INTO calls (id, caller_id, receiver_id, call_type, status, duration_seconds, created_at)
        VALUES (?, ?, ?, 'AUDIO', 'DECLINED', 0, ?)
      `).run(recordedCallId, caller_id, userId, now);
            syncUpsert('calls', {
                id: recordedCallId,
                caller_id,
                receiver_id: userId,
                call_type: 'AUDIO',
                status: 'DECLINED',
                duration_seconds: 0,
                created_at: now
            });
        });
        socket.on('end_call', (data) => {
            const { target_user_id, call_id, call_type = 'AUDIO', duration_seconds = 0 } = data;
            console.log(`🛑 [Chaukdi Call] Call ${call_id} ended. Duration: ${duration_seconds}s`);
            const targetSockets = userSocketsMap.get(target_user_id);
            if (targetSockets) {
                targetSockets.forEach(sockId => {
                    io.to(sockId).emit('call_ended', { call_id, duration_seconds });
                });
            }
            // Record Completed Call in DB
            const now = new Date().toISOString();
            const endCallId = call_id || ('call_' + uuidv4().substring(0, 10));
            db.prepare(`
        INSERT INTO calls (id, caller_id, receiver_id, call_type, status, duration_seconds, created_at)
        VALUES (?, ?, ?, ?, 'COMPLETED', ?, ?)
      `).run(endCallId, userId, target_user_id, call_type, duration_seconds, now);
            syncUpsert('calls', {
                id: endCallId,
                caller_id: userId,
                receiver_id: target_user_id,
                call_type,
                status: 'COMPLETED',
                duration_seconds,
                created_at: now
            });
        });
        socket.on('webrtc_signal', (data) => {
            const { target_user_id, signal } = data;
            const targetSockets = userSocketsMap.get(target_user_id);
            if (targetSockets) {
                targetSockets.forEach(sockId => {
                    io.to(sockId).emit('webrtc_signal', {
                        sender_id: userId,
                        signal
                    });
                });
            }
        });
        // Disconnect Handler
        socket.on('disconnect', () => {
            const userSockets = userSocketsMap.get(userId);
            if (userSockets) {
                userSockets.delete(socket.id);
                if (userSockets.size === 0) {
                    userSocketsMap.delete(userId);
                    // Mark offline in DB
                    const offlineTime = new Date().toISOString();
                    db.prepare('UPDATE users SET is_online = 0, last_seen = ? WHERE id = ?').run(offlineTime, userId);
                    syncUpsert('users', { id: userId, is_online: 0, last_seen: offlineTime });
                    io.emit('user_presence', {
                        user_id: userId,
                        is_online: false,
                        last_seen: offlineTime
                    });
                    console.log(`🔴 [Chaukdi Socket] User disconnected: ${user.display_name} (${userId})`);
                }
            }
        });
    });
}
