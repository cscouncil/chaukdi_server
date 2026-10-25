import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../database.js';
import { syncUpsert } from '../supabase.js';
export const authRouter = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'chaukdi_sovereign_secret_key_2026';
// Authentication Middleware
export function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err)
            return res.status(403).json({ error: 'Invalid or expired token' });
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.id);
        if (!user)
            return res.status(404).json({ error: 'User not found' });
        req.user = user;
        next();
    });
}
// Mock OTP store for development (in production, integrate Fast2SMS / MSG91)
const otpStore = new Map();
export const recentOtpLogs = [
    {
        phone: '+919837623068',
        otp: '444584',
        timestamp: new Date().toLocaleTimeString(),
        status: 'Fast2SMS: You need to complete one transaction of 100 INR or more before using API route.',
        fast2sms_response: { status_code: 999 }
    }
];
// Fast2SMS Real-Time SMS Dispatcher with Dual Route Fallback (OTP & Quick Route)
async function sendFast2SmsOtp(phoneNumber, otp) {
    const apiKey = process.env.FAST2SMS_API_KEY;
    if (!apiKey || apiKey.trim() === '' || apiKey.includes('your_')) {
        return { success: false, message: 'Fast2SMS API Key is not set in .env yet' };
    }
    const rawNumber = phoneNumber.replace('+91', '').trim();
    // 1. Try OTP Route
    try {
        const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
            method: 'POST',
            headers: {
                'authorization': apiKey.trim(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                route: 'otp',
                variables_values: otp,
                numbers: rawNumber
            })
        });
        const data = await response.json();
        console.log(`📡 [Fast2SMS OTP Route for ${phoneNumber}]:`, JSON.stringify(data));
        if (data.return === true) {
            return { success: true, message: 'Real SMS successfully dispatched to your mobile!', data };
        }
        // 2. If website verification needed, try Quick SMS Route 'q'
        const resQ = await fetch('https://www.fast2sms.com/dev/bulkV2', {
            method: 'POST',
            headers: {
                'authorization': apiKey.trim(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                route: 'q',
                message: `Your Chaukdi verification code is ${otp}. Valid for 10 mins. - Sovereign Bharat`,
                language: 'english',
                flash: 0,
                numbers: rawNumber
            })
        });
        const dataQ = await resQ.json();
        console.log(`📡 [Fast2SMS Quick Route for ${phoneNumber}]:`, JSON.stringify(dataQ));
        if (dataQ.return === true) {
            return { success: true, message: 'Real SMS successfully dispatched via Quick Route!', data: dataQ };
        }
        const errMsg = dataQ.message || (Array.isArray(data.message) ? data.message.join(', ') : data.message);
        return { success: false, message: errMsg, data: { otpRoute: data, quickRoute: dataQ } };
    }
    catch (err) {
        console.error('❌ Fast2SMS Gateway Network Error:', err);
        return { success: false, message: err.message };
    }
}
// 1. Send OTP with Strict Indian Phone Validation & Fast2SMS Dispatch
authRouter.post('/otp/send', async (req, res) => {
    let { phone_number } = req.body;
    if (!phone_number || typeof phone_number !== 'string') {
        return res.status(400).json({ error: 'Phone number is required' });
    }
    // Normalize phone number
    phone_number = phone_number.trim().replace(/\s+/g, '');
    if (!phone_number.startsWith('+91')) {
        phone_number = '+91' + (phone_number.startsWith('0') ? phone_number.substring(1) : phone_number);
    }
    // Strict Indian mobile validation: +91 followed by 10 digits starting with 6, 7, 8, or 9
    const indianPhoneRegex = /^\+91[6-9]\d{9}$/;
    if (!indianPhoneRegex.test(phone_number)) {
        return res.status(400).json({
            error: 'Invalid Indian phone number! Number 10-digit ka hona chahiye aur 6, 7, 8, ya 9 se shuru hona chahiye.'
        });
    }
    // Generate genuine real-time 6-digit random OTP for EVERY request
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(phone_number, {
        otp,
        expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes
    });
    console.log(`\n======================================================`);
    console.log(`📲 [Chaukdi Live OTP Gateway]`);
    console.log(`   To Mobile: ${phone_number}`);
    console.log(`   Realtime 6-digit OTP: >>> ${otp} <<<`);
    console.log(`======================================================\n`);
    // Dispatch Real SMS via Fast2SMS
    const smsResult = await sendFast2SmsOtp(phone_number, otp);
    // Log to recent OTPs for Admin Console Visibility
    recentOtpLogs.unshift({
        phone: phone_number,
        otp,
        timestamp: new Date().toLocaleTimeString(),
        status: smsResult.success ? 'Delivered via Real SMS' : `Fast2SMS Gateway Error: ${smsResult.message}`,
        fast2sms_response: smsResult.data
    });
    if (recentOtpLogs.length > 50)
        recentOtpLogs.pop();
    res.json({
        success: true,
        message: smsResult.success ? 'Real SMS sent to your mobile!' : `OTP generated (${smsResult.message})`,
        phone_number,
        // Provided so testing is never blocked when Fast2SMS wallet is unrecharged
        dev_hint_otp: !smsResult.success ? otp : undefined,
        sms_gateway: {
            provider: 'Fast2SMS',
            dispatched: smsResult.success,
            details: smsResult.message
        }
    });
});
// 2. Verify OTP & Check New User status
authRouter.post('/otp/verify', (req, res) => {
    let { phone_number, otp } = req.body;
    if (!phone_number || !otp) {
        return res.status(400).json({ error: 'Phone number and OTP are required' });
    }
    phone_number = phone_number.trim().replace(/\s+/g, '');
    if (!phone_number.startsWith('+91')) {
        phone_number = '+91' + (phone_number.startsWith('0') ? phone_number.substring(1) : phone_number);
    }
    // Check OTP strictly against stored OTP (No hardcoded fallback)
    const stored = otpStore.get(phone_number);
    const isValidOtp = stored && stored.otp === otp && Date.now() <= stored.expiresAt;
    if (!isValidOtp) {
        return res.status(400).json({ error: 'Galat ya expired OTP! Kripya sahi 6-digit OTP daalein.' });
    }
    // Consume OTP once verified
    otpStore.delete(phone_number);
    // Check if user exists
    let user = db.prepare('SELECT * FROM users WHERE phone_number = ?').get(phone_number);
    let isNewUser = false;
    if (!user) {
        isNewUser = true;
        const userId = 'u_' + uuidv4().substring(0, 8);
        const generatedUsername = 'user_' + phone_number.slice(-4) + '_' + Math.floor(Math.random() * 1000);
        db.prepare(`
      INSERT INTO users (id, phone_number, username, display_name, avatar_url, about, role)
      VALUES (?, ?, ?, ?, ?, ?, 'USER')
    `).run(userId, phone_number, generatedUsername, 'Chaukdi Member', `https://api.dicebear.com/7.x/identicon/svg?seed=${userId}`, 'Chaukdi pe baatcheet jari hai.');
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        syncUpsert('users', user);
    }
    else {
        // If user's display name is default, treat as needing profile setup
        if (user.display_name === 'Chaukdi Member') {
            isNewUser = true;
        }
    }
    // Generate JWT token
    const token = jwt.sign({ id: user.id, phone: user.phone_number, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
        success: true,
        token,
        user,
        is_new_user: isNewUser
    });
});
// 3. Get Current User Profile
authRouter.get('/me', authenticateToken, (req, res) => {
    res.json({ user: req.user });
});
// 4. Update Profile
authRouter.put('/profile', authenticateToken, (req, res) => {
    const { display_name, username, about, avatar_url, cover_photo_url, category, business_hours, address, website, instagram, facebook, email, upi_qr, catalog } = req.body;
    const userId = req.user.id;
    db.prepare(`
    UPDATE users 
    SET display_name = COALESCE(?, display_name),
        username = COALESCE(?, username),
        about = COALESCE(?, about),
        avatar_url = COALESCE(?, avatar_url),
        cover_photo_url = COALESCE(?, cover_photo_url),
        category = COALESCE(?, category),
        business_hours = COALESCE(?, business_hours),
        address = COALESCE(?, address),
        website = COALESCE(?, website),
        instagram = COALESCE(?, instagram),
        facebook = COALESCE(?, facebook),
        email = COALESCE(?, email),
        upi_qr = COALESCE(?, upi_qr),
        catalog = COALESCE(?, catalog)
    WHERE id = ?
  `).run(display_name ?? null, username ?? null, about ?? null, avatar_url ?? null, cover_photo_url ?? null, category ?? null, business_hours ?? null, address ?? null, website ?? null, instagram ?? null, facebook ?? null, email ?? null, upi_qr ?? null, catalog ?? null, userId);
    const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (updatedUser)
        syncUpsert('users', updatedUser);
    res.json({ success: true, user: updatedUser });
});
// 5. Starred Messages
authRouter.get('/starred', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const starred = db.prepare(`
    SELECT sm.id as starred_id, sm.created_at as starred_at,
           m.*, u.display_name as sender_name, u.avatar_url as sender_avatar,
           c.type as chat_type, g.name as group_name
    FROM starred_messages sm
    JOIN messages m ON sm.message_id = m.id
    JOIN users u ON m.sender_id = u.id
    JOIN chats c ON m.chat_id = c.id
    LEFT JOIN groups g ON c.group_id = g.id
    WHERE sm.user_id = ?
    ORDER BY sm.created_at DESC
  `).all(userId);
    res.json({ starred });
});
authRouter.post('/starred/:messageId', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const { messageId } = req.params;
    const starId = 'star_' + uuidv4().substring(0, 8);
    db.prepare(`
    INSERT OR IGNORE INTO starred_messages (id, user_id, message_id)
    VALUES (?, ?, ?)
  `).run(starId, userId, messageId);
    res.json({ success: true, message: 'Message starred' });
});
authRouter.delete('/starred/:messageId', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const { messageId } = req.params;
    db.prepare('DELETE FROM starred_messages WHERE user_id = ? AND message_id = ?').run(userId, messageId);
    res.json({ success: true, message: 'Message unstarred' });
});
// 6. Linked Devices
authRouter.get('/devices', authenticateToken, (req, res) => {
    const userId = req.user.id;
    let devices = db.prepare('SELECT * FROM linked_devices WHERE user_id = ? ORDER BY last_active DESC').all(userId);
    if (devices.length === 0) {
        // Default active device
        const devId = 'dev_' + uuidv4().substring(0, 8);
        db.prepare(`
      INSERT INTO linked_devices (id, user_id, device_name, platform, location, last_active)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(devId, userId, 'Google Chrome (Windows)', 'WEB', 'New Delhi, India');
        devices = db.prepare('SELECT * FROM linked_devices WHERE user_id = ?').all(userId);
    }
    res.json({ devices });
});
authRouter.post('/devices', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const { device_name, platform } = req.body;
    const devId = 'dev_' + uuidv4().substring(0, 8);
    db.prepare(`
    INSERT INTO linked_devices (id, user_id, device_name, platform, location)
    VALUES (?, ?, ?, ?, 'New Delhi, India')
  `).run(devId, userId, device_name || 'Chaukdi Web', platform || 'WEB');
    res.json({ success: true, id: devId, message: 'Device linked' });
});
authRouter.delete('/devices/:deviceId', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const { deviceId } = req.params;
    db.prepare('DELETE FROM linked_devices WHERE id = ? AND user_id = ?').run(deviceId, userId);
    res.json({ success: true, message: 'Device logged out' });
});
// 7. Business Broadcasts
authRouter.get('/broadcasts', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const broadcasts = db.prepare('SELECT * FROM broadcasts WHERE creator_id = ? ORDER BY created_at DESC').all(userId);
    res.json({ broadcasts });
});
authRouter.post('/broadcasts', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const { title, recipient_count } = req.body;
    const bId = 'bc_' + uuidv4().substring(0, 8);
    db.prepare(`
    INSERT INTO broadcasts (id, creator_id, title, recipient_count)
    VALUES (?, ?, ?, ?)
  `).run(bId, userId, title || 'New Broadcast List', recipient_count || 0);
    res.json({ success: true, id: bId, message: 'Broadcast list created' });
});
// 8. Get All Users (for discovering contacts / starting new chats)
authRouter.get('/users', authenticateToken, (req, res) => {
    const currentUserId = req.user.id;
    const users = db.prepare('SELECT id, phone_number, username, display_name, avatar_url, cover_photo_url, about, category, business_hours, address, website, instagram, facebook, email, is_online, last_seen FROM users WHERE id != ?').all(currentUserId);
    res.json({ users });
});
