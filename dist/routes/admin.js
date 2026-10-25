import { Router } from 'express';
import { db } from '../database.js';
import { authenticateToken, recentOtpLogs } from './auth.js';
export const adminRouter = Router();
// Middleware: Check RBAC Role
export function requireRole(allowedRoles) {
    return (req, res, next) => {
        const userRole = req.user?.role || 'USER';
        if (!allowedRoles.includes(userRole)) {
            return res.status(403).json({
                error: `Permission Denied! Required roles: [${allowedRoles.join(', ')}]. Your role: ${userRole}`
            });
        }
        next();
    };
}
// 1. Get System Metrics (Super Admin & Operators)
adminRouter.get('/metrics', authenticateToken, requireRole(['SUPER_ADMIN', 'ADMIN', 'OPERATOR']), (req, res) => {
    const totalUsers = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
    const onlineUsers = db.prepare('SELECT COUNT(*) as cnt FROM users WHERE is_online = 1').get().cnt;
    const totalGroups = db.prepare('SELECT COUNT(*) as cnt FROM groups').get().cnt;
    const totalMessages = db.prepare('SELECT COUNT(*) as cnt FROM messages').get().cnt;
    const totalCalls = db.prepare('SELECT COUNT(*) as cnt FROM calls').get().cnt;
    // Role breakdown
    const roleStats = db.prepare(`
      SELECT role, COUNT(*) as count FROM users GROUP BY role
    `).all();
    res.json({
        metrics: {
            total_users: totalUsers,
            online_users: onlineUsers,
            total_squads: totalGroups,
            total_messages: totalMessages,
            total_calls: totalCalls,
        },
        roles_breakdown: roleStats,
        server_info: {
            node_version: process.version,
            uptime_seconds: Math.floor(process.uptime()),
            memory_usage_mb: Math.floor(process.memoryUsage().heapUsed / 1024 / 1024),
            sovereignty: '100% Hosted in Bharat (Local)',
        }
    });
});
// 2. Manage Users (Super Admin, Admins, Checkers)
adminRouter.get('/users', authenticateToken, requireRole(['SUPER_ADMIN', 'ADMIN', 'CHECKER', 'MODERATOR']), (req, res) => {
    const users = db.prepare(`
      SELECT id, phone_number, username, display_name, avatar_url, role, is_online, last_seen, created_at
      FROM users
      ORDER BY created_at DESC
    `).all();
    res.json({ users });
});
// 3. Update User Role (Super Admin Only)
adminRouter.put('/users/:userId/role', authenticateToken, requireRole(['SUPER_ADMIN']), (req, res) => {
    const { userId } = req.params;
    const { role } = req.body;
    const validRoles = ['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'CHECKER', 'MODERATOR', 'USER'];
    if (!validRoles.includes(role)) {
        return res.status(400).json({ error: `Invalid role. Allowed: ${validRoles.join(', ')}` });
    }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
    res.json({ success: true, message: `Role updated to ${role} for user ${userId}` });
});
// 4. Permanently Delete User (Super Admin & Admins)
adminRouter.delete('/users/:userId', authenticateToken, requireRole(['SUPER_ADMIN', 'ADMIN']), (req, res) => {
    const { userId } = req.params;
    // Protect primary Super Admin
    if (userId === 'u_aarav_01') {
        return res.status(400).json({ error: 'Primary Super Administrator account cannot be deleted!' });
    }
    try {
        db.prepare('DELETE FROM chat_participants WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM group_members WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM messages WHERE sender_id = ?').run(userId);
        db.prepare('DELETE FROM statuses WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM calls WHERE caller_id = ? OR receiver_id = ?').run(userId, userId);
        db.prepare('DELETE FROM starred_messages WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM linked_devices WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    }
    catch (e) {
        db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    }
    res.json({ success: true, message: `User ${userId} permanently deleted. They can now register fresh!` });
});
// 5. Squads / Groups List (Moderation)
adminRouter.get('/groups', authenticateToken, requireRole(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'CHECKER', 'MODERATOR']), (req, res) => {
    const groups = db.prepare(`
      SELECT g.id, g.name, g.created_at, u.display_name as creator_name,
             (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
      FROM groups g
      JOIN users u ON g.creator_id = u.id
      ORDER BY g.created_at DESC
    `).all();
    res.json({ groups });
});
// 6. Configure Fast2SMS API Key (Super Admin & Admins)
adminRouter.post('/fast2sms', authenticateToken, requireRole(['SUPER_ADMIN', 'ADMIN']), async (req, res) => {
    const { api_key, test_phone } = req.body;
    if (!api_key || typeof api_key !== 'string') {
        return res.status(400).json({ error: 'Valid Fast2SMS API key is required' });
    }
    process.env.FAST2SMS_API_KEY = api_key.trim();
    // Test send if phone provided
    let testResult = null;
    if (test_phone) {
        try {
            const rawNumber = test_phone.replace('+91', '').trim();
            const testOtp = Math.floor(100000 + Math.random() * 900000).toString();
            const fastRes = await fetch('https://www.fast2sms.com/dev/bulkV2', {
                method: 'POST',
                headers: {
                    'authorization': api_key.trim(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    route: 'otp',
                    variables_values: testOtp,
                    numbers: rawNumber
                })
            });
            testResult = await fastRes.json();
        }
        catch (err) {
            testResult = { error: err.message };
        }
    }
    res.json({
        success: true,
        message: 'Fast2SMS API Key configured successfully!',
        test_result: testResult
    });
});
// 7. Live OTP Logs Stream (Super Admin & Operators)
adminRouter.get('/otp-logs', authenticateToken, requireRole(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'CHECKER']), (req, res) => {
    res.json({
        success: true,
        logs: recentOtpLogs
    });
});
