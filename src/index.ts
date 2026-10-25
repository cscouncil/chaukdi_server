import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase } from './database.js';
import { setupSocketIO } from './socket.js';
import { authRouter } from './routes/auth.js';
import { chatsRouter } from './routes/chats.js';
import { groupsRouter } from './routes/groups.js';
import { statusRouter } from './routes/status.js';
import { callsRouter } from './routes/calls.js';
import { adminRouter } from './routes/admin.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// Serve Static Assets & Admin Dashboard
app.use(express.static(path.join(__dirname, '..', 'public')));

// Enable CORS for web clients & local apps
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

app.use(express.json());

// Initialize SQLite database & seed default data
initDatabase();

// Setup WebSocket gateway
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

setupSocketIO(io);

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/chats', chatsRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/status', statusRouter);
app.use('/api/calls', callsRouter);
app.use('/api/admin', adminRouter);

// Serve Admin Portal at /admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

// Direct APK Download Endpoint
app.get('/download', (req, res) => {
  const apkPath = path.join(__dirname, '..', 'public', 'chaukdi.apk');
  res.download(apkPath, 'Chaukdi.apk');
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Chaukdi Sovereign Realtime Server',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Chaukdi Server is running live on http://localhost:${PORT}`);
  console.log(`📡 WebSocket Gateway ready for Real-Time WhatsApp Ticks`);
  console.log(`🇮🇳 Sovereign Indian Data Layer: 100% Local`);
  console.log(`======================================================\n`);
});
