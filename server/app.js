import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import authRoutes from './routes/auth.js';
import fileRoutes from './routes/files.js';
import { authRateLimit } from './middleware/rateLimit.js';
import { USE_LOCAL_STORAGE } from './config/s3.js';

/**
 * Create and configure the Express application (without Socket.io / CDC).
 * Exported separately so integration tests can use supertest.
 */
export const createApp = () => {
    const app = express();

    app.use(cors({
        origin: process.env.CLIENT_URL || 'http://localhost:5173',
        credentials: true,
    }));
    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: true, limit: '1mb' }));
    app.use(cookieParser());
    app.disable('x-powered-by');

    app.get('/health', async (req, res) => {
        const mongoState = mongoose.connection.readyState;
        const mongoOk = mongoState === 1;

        res.status(mongoOk ? 200 : 503).json({
            status: mongoOk ? 'ok' : 'degraded',
            timestamp: new Date().toISOString(),
            checks: {
                mongodb: mongoOk ? 'connected' : 'disconnected',
                storage: USE_LOCAL_STORAGE ? 'local' : 's3',
            },
        });
    });

    app.use('/api/auth', authRateLimit, authRoutes);
    app.use('/api/files', fileRoutes);

    app.use((req, res) => {
        res.status(404).json({ error: 'Route not found' });
    });

    app.use((err, req, res, next) => {
        console.error('Server error:', err);
        res.status(500).json({
            error: 'Internal server error',
            message: process.env.NODE_ENV === 'development' ? err.message : undefined,
        });
    });

    return app;
};
