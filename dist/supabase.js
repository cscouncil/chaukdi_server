import pg from 'pg';
import { db } from './database.js';
const connectionString = process.env.DATABASE_URL ||
    'postgresql://postgres.pocdvusbuxnulcshimdc:Chaukdi%402026%23@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres';
export const pool = new pg.Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});
// Cloud Table Schema DDL for Supabase PostgreSQL
const SCHEMA_DDL = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    phone_number TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    about TEXT DEFAULT 'Chaukdi pe baatcheet jari hai.',
    role TEXT DEFAULT 'USER' CHECK(role IN ('SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'CHECKER', 'MODERATOR', 'USER')),
    is_online INTEGER DEFAULT 0,
    last_seen TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    cover_photo_url TEXT,
    category TEXT DEFAULT 'Education',
    business_hours TEXT DEFAULT 'Mon-Sat: Open 24 hours, Sun: Closed',
    address TEXT DEFAULT 'C63, Gandhi Nagar, Moradabad, Uttar Pradesh 244001, India',
    website TEXT DEFAULT 'https://www.codever.in',
    instagram TEXT DEFAULT 'codever',
    facebook TEXT DEFAULT 'Facebook',
    email TEXT DEFAULT 'info@codever.in',
    upi_qr TEXT DEFAULT 'codever@upi',
    catalog TEXT DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS statuses (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    media_url TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL
  );

  CREATE TABLE IF NOT EXISTS calls (
    id TEXT PRIMARY KEY,
    caller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    call_type TEXT DEFAULT 'AUDIO' CHECK(call_type IN ('AUDIO', 'VIDEO')),
    status TEXT DEFAULT 'COMPLETED' CHECK(status IN ('MISSED', 'COMPLETED', 'DECLINED')),
    duration_seconds INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    avatar_url TEXT,
    creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('DIRECT', 'GROUP')),
    group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
    last_message_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chat_participants (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(chat_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS group_members (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'MEMBER' CHECK(role IN ('ADMIN', 'MEMBER')),
    joined_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(group_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    media_type TEXT DEFAULT 'TEXT' CHECK(media_type IN ('TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'DOC')),
    media_url TEXT,
    status TEXT DEFAULT 'SENT' CHECK(status IN ('SENT', 'DELIVERED', 'READ')),
    sent_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS starred_messages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, message_id)
  );

  CREATE TABLE IF NOT EXISTS linked_devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name TEXT NOT NULL,
    platform TEXT NOT NULL,
    location TEXT DEFAULT 'India',
    last_active TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS broadcasts (
    id TEXT PRIMARY KEY,
    creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    recipient_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id, sent_at DESC);
  CREATE INDEX IF NOT EXISTS idx_chat_participants_user ON chat_participants(user_id);
  CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number);
`;
const ALL_TABLES = [
    'users',
    'groups',
    'chats',
    'chat_participants',
    'group_members',
    'messages',
    'statuses',
    'calls',
    'starred_messages',
    'linked_devices',
    'broadcasts',
];
/**
 * Initializes the Supabase PostgreSQL connection, runs DDL,
 * and restores state from the cloud or pushes initial seed.
 */
export async function initSupabase() {
    try {
        console.log('⚡ [Supabase Sync] Connecting to Supabase Cloud Database...');
        await pool.query(SCHEMA_DDL);
        console.log('✅ [Supabase Sync] Cloud Database Schema Verified!');
        // Attempt to restore cloud data into local SQLite
        const hasData = await restoreFromSupabase();
        if (!hasData) {
            console.log('📤 [Supabase Sync] Supabase empty. Pushing local SQLite data to Cloud...');
            await syncAllToSupabase();
        }
        else {
            console.log('🎉 [Supabase Sync] Successfully synchronized cloud state into Chaukdi engine!');
        }
        // Schedule periodic background sync every 60 seconds
        setInterval(() => {
            syncAllToSupabase().catch((err) => console.warn('⚠️ [Supabase Periodic Sync Error]:', err?.message));
        }, 60000);
    }
    catch (err) {
        console.error('❌ [Supabase Init Failed]:', err?.message || err);
    }
}
/**
 * Restores all cloud records from Supabase into local SQLite
 */
export async function restoreFromSupabase() {
    try {
        const usersRes = await pool.query('SELECT * FROM users');
        if (!usersRes.rows || usersRes.rows.length === 0) {
            return false;
        }
        console.log(`📥 [Supabase Restore] Found ${usersRes.rows.length} users in Supabase. Restoring tables...`);
        for (const table of ALL_TABLES) {
            try {
                const res = await pool.query(`SELECT * FROM "${table}"`);
                if (res.rows && res.rows.length > 0) {
                    const firstRow = res.rows[0];
                    const cols = Object.keys(firstRow);
                    const placeholders = cols.map(() => '?').join(', ');
                    const insertStmt = db.prepare(`
            INSERT OR REPLACE INTO ${table} (${cols.join(', ')})
            VALUES (${placeholders})
          `);
                    const insertTx = db.transaction((rows) => {
                        for (const r of rows) {
                            const vals = cols.map((col) => {
                                const val = r[col];
                                if (val instanceof Date)
                                    return val.toISOString();
                                return val;
                            });
                            insertStmt.run(...vals);
                        }
                    });
                    insertTx(res.rows);
                    console.log(`   ↳ Restored ${res.rows.length} rows for '${table}'`);
                }
            }
            catch (tblErr) {
                console.warn(`   ↳ Warning restoring '${table}':`, tblErr?.message);
            }
        }
        return true;
    }
    catch (err) {
        console.error('❌ [Supabase Restore Error]:', err?.message || err);
        return false;
    }
}
/**
 * Upserts a single record to Supabase Cloud asynchronously (fire & forget / non-blocking)
 */
export function syncUpsert(table, record) {
    // Execute asynchronously so API latency is 0ms
    setImmediate(async () => {
        try {
            const keys = Object.keys(record).filter((k) => record[k] !== undefined);
            if (keys.length === 0)
                return;
            const cols = keys.map((k) => `"${k}"`).join(', ');
            const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
            const values = keys.map((k) => {
                const v = record[k];
                if (v instanceof Date)
                    return v.toISOString();
                return v;
            });
            const updates = keys
                .filter((k) => k !== 'id')
                .map((k) => `"${k}" = EXCLUDED."${k}"`)
                .join(', ');
            const sql = `
        INSERT INTO "${table}" (${cols})
        VALUES (${placeholders})
        ON CONFLICT ("id")
        DO ${updates.length > 0 ? `UPDATE SET ${updates}` : 'NOTHING'}
      `;
            await pool.query(sql, values);
        }
        catch (err) {
            console.warn(`⚠️ [Supabase Upsert Warning in ${table}]:`, err?.message || err);
        }
    });
}
/**
 * Deletes a record from Supabase Cloud asynchronously
 */
export function syncDelete(table, id) {
    setImmediate(async () => {
        try {
            await pool.query(`DELETE FROM "${table}" WHERE id = $1`, [id]);
        }
        catch (err) {
            console.warn(`⚠️ [Supabase Delete Warning in ${table}]:`, err?.message || err);
        }
    });
}
/**
 * Pushes all SQLite tables to Supabase Cloud
 */
export async function syncAllToSupabase() {
    for (const table of ALL_TABLES) {
        try {
            const rows = db.prepare(`SELECT * FROM ${table}`).all();
            if (!rows || rows.length === 0)
                continue;
            for (const row of rows) {
                const keys = Object.keys(row).filter((k) => row[k] !== null && row[k] !== undefined);
                if (keys.length === 0)
                    continue;
                const cols = keys.map((k) => `"${k}"`).join(', ');
                const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
                const values = keys.map((k) => row[k]);
                const updates = keys
                    .filter((k) => k !== 'id')
                    .map((k) => `"${k}" = EXCLUDED."${k}"`)
                    .join(', ');
                const sql = `
          INSERT INTO "${table}" (${cols})
          VALUES (${placeholders})
          ON CONFLICT ("id")
          DO ${updates.length > 0 ? `UPDATE SET ${updates}` : 'NOTHING'}
        `;
                await pool.query(sql, values);
            }
        }
        catch (tblErr) {
            console.warn(`⚠️ [Supabase Sync Error in ${table}]:`, tblErr?.message);
        }
    }
}
