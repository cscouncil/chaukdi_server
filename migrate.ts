import { db } from './src/database.ts';

const cols = [
  "ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'USER'",
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

for (const sql of cols) {
  try {
    db.exec(sql);
    console.log('✅ Migrated:', sql);
  } catch (err: any) {
    console.log('ℹ️ Notice:', err.message);
  }
}

// Only Aarav Sharma is SUPER_ADMIN, all other users are standard USER
try {
  db.prepare("UPDATE users SET role = 'SUPER_ADMIN' WHERE id = 'u_aarav_01'").run();
  db.prepare("UPDATE users SET role = 'USER' WHERE id != 'u_aarav_01'").run();
  console.log('✅ Only Aarav Sharma is SUPER_ADMIN. All other users are standard USER.');
} catch (e: any) {
  console.error('Role update error:', e.message);
}

// Check all users
const users = db.prepare('SELECT id, phone_number, display_name, role FROM users').all();
console.log('📋 All Users in DB:');
console.log(JSON.stringify(users, null, 2));
