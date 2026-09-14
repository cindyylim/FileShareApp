import http from 'http';
import mongoose from 'mongoose';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { connectDB, setupDBEventHandlers } from './config/db.js';
import { validateEnv } from './config/env.js';
import { createApp } from './app.js';
import CDCService from './services/cdcService.js';

validateEnv();

const app = createApp();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: process.env.CLIENT_URL || 'http://localhost:5173',
        credentials: true,
    }
});

// Initialize CDC Service
let cdcService;

// Socket.io authentication middleware
io.use((socket, next) => {
    // Parse cookies from handshake headers
    const cookieHeader = socket.handshake.headers.cookie;
    if (!cookieHeader) {
        return next(new Error('Authentication error: No cookies found'));
    }

    // Extract token from cookie string
    const tokenMatch = cookieHeader.match(/token=([^;]+)/);
    const token = tokenMatch ? tokenMatch[1] : null;

    if (!token) {
        return next(new Error('Authentication error: No token found in cookies'));
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.userId = decoded.userId;
        next();
    } catch (error) {
        next(new Error('Authentication error: Invalid token'));
    }
});

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log(`🔌 New socket connection: ${socket.id} (User: ${socket.userId})`);

    // Register user socket in CDC service
    if (cdcService) {
        cdcService.registerUserSocket(socket.userId, socket.id);
    }

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log(`🔌 Socket disconnected: ${socket.id}`);

        if (cdcService) {
            cdcService.unregisterUserSocket(socket.userId, socket.id);
        }
    });

    // Ping-pong for connection health
    socket.on('ping', () => {
        socket.emit('pong');
    });
});

// Start server
const PORT = process.env.PORT || 5000;

const startServer = async () => {
    try {
        // Connect to MongoDB
        await connectDB();
        setupDBEventHandlers();

        // Start CDC Service
        cdcService = new CDCService(io);
        await cdcService.start();

        // Start HTTP server
        httpServer.listen(PORT, () => {
            console.log(`\n🚀 Server running on port ${PORT}`);
            console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`🌐 Client URL: ${process.env.CLIENT_URL || 'http://localhost:5173'}\n`);
        });

    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

const shutdown = async (signal) => {
    console.log(`\n⏹️  ${signal} received, shutting down gracefully...`);

    if (cdcService) {
        await cdcService.stop();
    }

    httpServer.close(async () => {
        await mongoose.disconnect();
        console.log('✅ Server closed');
        process.exit(0);
    });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

startServer();
