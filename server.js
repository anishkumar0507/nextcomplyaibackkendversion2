import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { connectDB } from './config/database.js';
import auditRoutes from './routes/auditRoutes.js';
import rulesRoutes from './routes/rulesRoutes.js';
import urlAuditRoutes from './routes/urlAudit.route.ts';
import { createServer } from 'http';

// FIX 6: Socket.io for rule update notifications (optional - install with: npm install socket.io)
let io = null;
try {
  const socketIO = await import('socket.io');
  io = socketIO.Server;
  console.log('[Server] ✓ Socket.IO available for rule updates');
} catch (e) {
  console.warn('[Server] ⚠️ Socket.IO not installed - rule update notifications disabled');
  console.warn('[Server]    Install with: npm install socket.io');
}

// Import auth routes
console.log('[Server] Importing auth routes...');
import authRoutes from './routes/authRoutes.js';
console.log('[Server] Auth routes imported:', authRoutes ? '✅' : '❌');

// Load environment variables
dotenv.config();

// Setup Google Application Credentials from JSON env var
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  console.log('[Server] Setting up Google Application Credentials from JSON env var...');
  try {
    const rawCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    console.log('[Server] Raw credentials length:', rawCredentials?.length);
    
    const credentials = JSON.parse(rawCredentials);
    console.log('[Server] Parsed credentials project_id:', credentials.project_id);
    console.log('[Server] Parsed credentials client_email:', credentials.client_email);
    
    // Create temp file path
    const tempPath = path.join(process.cwd(), 'service-account.json');
    console.log('[Server] Writing credentials to temp file:', tempPath);
    
    // Write JSON to file
    fs.writeFileSync(tempPath, JSON.stringify(credentials, null, 2));
    console.log('[Server] ✓ Temp credentials file created');
    
    // Set environment variable for Google SDKs
    process.env.GOOGLE_APPLICATION_CREDENTIALS = tempPath;
    console.log('[Server] ✓ GOOGLE_APPLICATION_CREDENTIALS set to:', tempPath);
  } catch (error) {
    console.error('[Server] ❌ Failed to setup credentials:', error.message);
    throw error;
  }
}

// Validate required environment variables
const projectId = process.env.VERTEX_PROJECT_ID || process.env.VERTEX_AI_PROJECT_ID || process.env.GOOGLE_VERTEX_PROJECT;
const missingEnv = [];

if (!projectId) {
  missingEnv.push('VERTEX_PROJECT_ID');
}

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  missingEnv.push('GOOGLE_APPLICATION_CREDENTIALS_JSON');
}

if (missingEnv.length > 0) {
  console.error(`Missing required environment variables: ${missingEnv.join(", ")}`);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;

// FIX 6: Create HTTP server for Socket.IO support
const httpServer = createServer(app);

// FIX 6: Initialize Socket.IO if available
let socketServer = null;
if (io) {
  socketServer = new io(httpServer, {
    cors: {
      origin: [
        'https://nextcomplyai.com',
        'https://www.nextcomplyai.com',
        'https://www.nextdoc.in',
        'https://nextdoc.in',
        'http://localhost:3000',
        'http://localhost:5173'
      ],
      methods: ['GET', 'POST'],
      credentials: true
    }
  });
  
  socketServer.on('connection', (socket) => {
    console.log('[WebSocket] Client connected:', socket.id);
    
    socket.on('disconnect', () => {
      console.log('[WebSocket] Client disconnected:', socket.id);
    });
  });
  
  console.log('[Server] ✓ WebSocket server initialized for rule updates');
}

// Export function to emit rule update notifications
export const notifyRuleUpdate = (updateData = {}) => {
  if (socketServer) {
    socketServer.emit('rule-update', {
      timestamp: new Date().toISOString(),
      version: updateData.version || Date.now(),
      message: 'Rule pack updated - please refresh to load latest rules',
      ...updateData
    });
    console.log('[WebSocket] Emitted rule-update event to all clients');
  } else {
    console.warn('[WebSocket] Cannot emit rule-update - Socket.IO not available');
  }
};

// CORS Configuration - MUST be before routes
app.use(cors({
  origin: [
    'https://nextcomplyai.com',
    'https://www.nextcomplyai.com',
    'https://www.nextdoc.in',
    'https://nextdoc.in',
    'http://localhost:3000',
    'http://localhost:5173'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
  optionsSuccessStatus: 200
}));

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));


// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'NextComply AI Backend is running' });
});

// Auth routes - must be registered before error handlers
console.log('📝 Registering auth routes...');
console.log('   Imported authRoutes:', authRoutes ? '✅' : '❌');
console.log('   Auth routes type:', typeof authRoutes);
try {
  if (!authRoutes) {
    throw new Error('authRoutes is undefined - import failed');
  }
  app.use('/api/auth', authRoutes);
  console.log('✅ Auth routes successfully registered at /api/auth');
  console.log('   Available auth endpoints:');
  console.log('     - GET  /api/auth/health');
  console.log('     - POST /api/auth/signup');
  console.log('     - POST /api/auth/login');
} catch (error) {
  console.error('❌ Error registering auth routes:', error);
  console.error('   Error stack:', error.stack);
  throw error;
}

app.use('/api', auditRoutes);
app.use('/api', rulesRoutes);
app.use('/api', urlAuditRoutes);

// 404 handler for undefined routes
app.use((req, res, next) => {
  res.status(404).json({ 
    error: 'Route not found',
    path: req.path,
    method: req.method
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server with automatic port detection
(async () => {
  try {
    // Connect to MongoDB
    try {
      await connectDB();
    } catch (dbError) {
      console.warn('⚠️  MongoDB connection failed. Auth features will not work:', dbError.message);
      console.warn('   Set MONGODB_URI in your .env file to enable authentication.');
    }

    httpServer.listen(PORT, () => {
      console.log(`🚀 NextComply AI Backend server running on port ${PORT}`);
      console.log(`📍 Backend URL: http://localhost:${PORT}`);
      console.log(`📍 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
      console.log(`☁️  Vertex AI Project: ${projectId || '✗ Missing'}`);
      console.log(`📍 Vertex AI Location: ${process.env.VERTEX_LOCATION || process.env.VERTEX_AI_LOCATION || 'us-central1'}`);
      console.log(`🔐 Service Account JSON: ${process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ? '✓ Configured' : '✗ Missing'}`);
      console.log(`💾 MongoDB: ${process.env.MONGODB_URI ? '✓ Configured' : '✗ Missing (Auth disabled)'}`);
      console.log(`🔌 WebSocket: ${socketServer ? '✓ Enabled (rule updates)' : '✗ Disabled (install socket.io)'}`);
      console.log(`🔗 Available routes:`);
      console.log(`   - GET  /health`);
      console.log(`   - POST /api/analyze`);
      console.log(`   - POST /api/audit`);
      console.log(`   - GET  /api/audit/history`);
      console.log(`   - GET  /api/audit/:id`);
      console.log(`   - GET  /api/auth/health`);
      console.log(`   - POST /api/auth/login`);
      console.log(`   - POST /api/auth/signup`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
})();

export default app;
