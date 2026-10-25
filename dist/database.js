import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '..', 'chaukdi.db');
export const db = new Database(dbPath);
// Enable WAL mode for high concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
export function initDatabase() {
    db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      phone_number TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      about TEXT DEFAULT 'Chaukdi pe baatcheet jari hai.',
      role TEXT DEFAULT 'USER' CHECK(role IN ('SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'CHECKER', 'MODERATOR', 'USER')),
      is_online INTEGER DEFAULT 0,
      last_seen TEXT DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS statuses (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      media_url TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY,
      caller_id TEXT NOT NULL,
      receiver_id TEXT NOT NULL,
      call_type TEXT DEFAULT 'AUDIO' CHECK(call_type IN ('AUDIO', 'VIDEO')),
      status TEXT DEFAULT 'COMPLETED' CHECK(status IN ('MISSED', 'COMPLETED', 'DECLINED')),
      duration_seconds INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(caller_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(receiver_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      avatar_url TEXT,
      creator_id TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(creator_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('DIRECT', 'GROUP')),
      group_id TEXT,
      last_message_at TEXT DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_participants (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(chat_id, user_id),
      FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS group_members (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'MEMBER' CHECK(role IN ('ADMIN', 'MEMBER')),
      joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(group_id, user_id),
      FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      content TEXT NOT NULL,
      media_type TEXT DEFAULT 'TEXT' CHECK(media_type IN ('TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'DOC')),
      media_url TEXT,
      status TEXT DEFAULT 'SENT' CHECK(status IN ('SENT', 'DELIVERED', 'READ')),
      sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
      delivered_at TEXT,
      read_at TEXT,
      FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
      FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS starred_messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, message_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS linked_devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      device_name TEXT NOT NULL,
      platform TEXT NOT NULL,
      location TEXT DEFAULT 'India',
      last_active TEXT DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS broadcasts (
      id TEXT PRIMARY KEY,
      creator_id TEXT NOT NULL,
      title TEXT NOT NULL,
      recipient_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(creator_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id, sent_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_participants_user ON chat_participants(user_id);
    CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number);
  `);
    // Run dynamic schema migrations for user business profile fields
    const userColumns = [
        "ALTER TABLE users ADD COLUMN cover_photo_url TEXT",
        "ALTER TABLE users ADD COLUMN category TEXT DEFAULT 'Education'",
        "ALTER TABLE users ADD COLUMN business_hours TEXT DEFAULT 'Mon-Sat: Open 24 hours, Sun: Closed'",
        "ALTER TABLE users ADD COLUMN address TEXT DEFAULT 'C63, Gandhi Nagar, Moradabad, Uttar Pradesh 244001, India'",
        "ALTER TABLE users ADD COLUMN website TEXT DEFAULT 'https://www.codever.in'",
        "ALTER TABLE users ADD COLUMN instagram TEXT DEFAULT 'codever'",
        "ALTER TABLE users ADD COLUMN facebook TEXT DEFAULT 'Facebook'",
        "ALTER TABLE users ADD COLUMN email TEXT DEFAULT 'info@codever.in'",
        "ALTER TABLE users ADD COLUMN upi_qr TEXT DEFAULT 'codever@upi'",
        "ALTER TABLE users ADD COLUMN catalog TEXT DEFAULT '[]'"
    ];
    for (const alterSql of userColumns) {
        try {
            db.exec(alterSql);
        }
        catch (_) { }
    }
    // Seed sample users if empty
    const count = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
    if (count.cnt === 0) {
        seedInitialData();
    }
}
function seedInitialData() {
    const user1Id = 'u_aarav_01';
    const user2Id = 'u_priya_02';
    const user3Id = 'u_kabir_03';
    const aiBotId = 'u_chaukdi_ai';
    const insertUser = db.prepare(`
    INSERT INTO users (id, phone_number, username, display_name, avatar_url, about)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
    insertUser.run(aiBotId, '+910000000000', 'chaukdi_ai', 'Chaukdi AI 🤖', 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150', 'Bharat ka apna AI Dost. Mujhse kuch bhi pucho!');
    insertUser.run(user1Id, '+919876543210', 'aarav', 'Aarav Sharma', 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150', 'Jai Hind! Available on Chaukdi.');
    // Set Aarav as SUPER_ADMIN
    db.prepare("UPDATE users SET role = 'SUPER_ADMIN' WHERE id = ?").run(user1Id);
    insertUser.run(user2Id, '+919876543211', 'priya', 'Priya Patel', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150', 'Life is better with tea & friends ☕');
    // Set Priya as MODERATOR
    db.prepare("UPDATE users SET role = 'MODERATOR' WHERE id = ?").run(user2Id);
    insertUser.run(user3Id, '+919876543212', 'kabir', 'Kabir Singh', 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=150', 'Keep it simple. Always connected.');
    // Seed Status Updates (24-hour Stories)
    const insertStatus = db.prepare(`
    INSERT INTO statuses (id, user_id, content, media_url, created_at, expires_at)
    VALUES (?, ?, ?, ?, datetime('now', '-2 hours'), datetime('now', '+22 hours'))
  `);
    insertStatus.run(uuidv4(), user1Id, '🇮🇳 Chaukdi pe naya status! Bharat ka apna private messenger.', 'https://images.unsplash.com/photo-1532375810709-75b1da00537c?w=600');
    insertStatus.run(uuidv4(), user2Id, 'Chai time with besties! ☕✨', 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=600');
    // Seed Call History
    const insertCall = db.prepare(`
    INSERT INTO calls (id, caller_id, receiver_id, call_type, status, duration_seconds, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))
  `);
    insertCall.run(uuidv4(), user2Id, user1Id, 'AUDIO', 'COMPLETED', 142, '-45 minutes');
    insertCall.run(uuidv4(), user3Id, user1Id, 'VIDEO', 'MISSED', 0, '-3 hours');
    insertCall.run(uuidv4(), user1Id, user2Id, 'AUDIO', 'COMPLETED', 320, '-1 day');
    // Create sample 1-on-1 chat between Aarav and Priya
    const directChatId = 'chat_aarav_priya';
    db.prepare('INSERT INTO chats (id, type) VALUES (?, ?)').run(directChatId, 'DIRECT');
    db.prepare('INSERT INTO chat_participants (id, chat_id, user_id) VALUES (?, ?, ?)').run(uuidv4(), directChatId, user1Id);
    db.prepare('INSERT INTO chat_participants (id, chat_id, user_id) VALUES (?, ?, ?)').run(uuidv4(), directChatId, user2Id);
    // Seed initial messages
    const insertMessage = db.prepare(`
    INSERT INTO messages (id, chat_id, sender_id, content, status, sent_at, delivered_at, read_at)
    VALUES (?, ?, ?, ?, ?, datetime('now', '-10 minutes'), datetime('now', '-9 minutes'), datetime('now', '-8 minutes'))
  `);
    insertMessage.run(uuidv4(), directChatId, user1Id, 'Namaste Priya! Chaukdi pe aane ke liye shukriya.', 'READ');
    insertMessage.run(uuidv4(), directChatId, user2Id, 'Haan Aarav! Ye app kaafi clean aur fast lag rahi hai.', 'READ');
    // Create sample Chaukdi Group: "Chandal Chaukdi 🚀"
    const groupId = 'grp_chandal_chaukdi';
    const groupChatId = 'chat_grp_chandal_chaukdi';
    db.prepare(`
    INSERT INTO groups (id, name, description, avatar_url, creator_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(groupId, 'Chandal Chaukdi 🚀', 'College ke yaaron ki asli baithak!', 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=150', user1Id);
    db.prepare('INSERT INTO chats (id, type, group_id) VALUES (?, ?, ?)').run(groupChatId, 'GROUP', groupId);
    // Add members to group
    const addMember = db.prepare('INSERT INTO group_members (id, group_id, user_id, role) VALUES (?, ?, ?, ?)');
    const addParticipant = db.prepare('INSERT INTO chat_participants (id, chat_id, user_id) VALUES (?, ?, ?)');
    [user1Id, user2Id, user3Id].forEach((uid, index) => {
        addMember.run(uuidv4(), groupId, uid, index === 0 ? 'ADMIN' : 'MEMBER');
        addParticipant.run(uuidv4(), groupChatId, uid);
    });
    // Group messages
    insertMessage.run(uuidv4(), groupChatId, user1Id, 'Bhai sab log Chaukdi pe jud gaye na?', 'READ');
    insertMessage.run(uuidv4(), groupChatId, user3Id, 'Arre bilkul! Asli desi baithak shuru ho gayi hai!', 'READ');
    console.log('✅ Initial Indian Chaukdi demo data seeded successfully!');
}
