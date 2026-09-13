import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import User from '../../models/User.js';
import { authenticateToken, generateToken } from '../../middleware/auth.js';

const createMockRes = () => {
    const res = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
};

describe('auth middleware', () => {
    beforeEach(() => {
        process.env.JWT_SECRET = 'test-jwt-secret';
    });

    describe('generateToken', () => {
        it('returns a valid JWT containing the userId', () => {
            const userId = '507f1f77bcf86cd799439011';
            const token = generateToken(userId);
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            expect(decoded.userId).toBe(userId);
        });
    });

    describe('authenticateToken', () => {
        it('returns 401 when no token is provided', async () => {
            const req = { cookies: {}, headers: {} };
            const res = createMockRes();
            const next = vi.fn();

            await authenticateToken(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Access denied. No token provided.',
            });
            expect(next).not.toHaveBeenCalled();
        });

        it('attaches user to request when token is valid (cookie)', async () => {
            const user = await User.create({
                username: 'testuser',
                email: 'test@example.com',
                password: 'password123',
            });

            const token = generateToken(user._id);
            const req = { cookies: { token }, headers: {} };
            const res = createMockRes();
            const next = vi.fn();

            await authenticateToken(req, res, next);

            expect(next).toHaveBeenCalled();
            expect(req.user._id.toString()).toBe(user._id.toString());
            expect(req.user.password).toBeUndefined();
        });

        it('accepts Bearer token from Authorization header', async () => {
            const user = await User.create({
                username: 'beareruser',
                email: 'bearer@example.com',
                password: 'password123',
            });

            const token = generateToken(user._id);
            const req = {
                cookies: {},
                headers: { authorization: `Bearer ${token}` },
            };
            const res = createMockRes();
            const next = vi.fn();

            await authenticateToken(req, res, next);

            expect(next).toHaveBeenCalled();
            expect(req.user.email).toBe('bearer@example.com');
        });

        it('returns 401 for invalid token', async () => {
            const req = {
                cookies: { token: 'invalid-token' },
                headers: {},
            };
            const res = createMockRes();
            const next = vi.fn();

            await authenticateToken(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token.' });
        });

        it('returns 401 when user no longer exists', async () => {
            const userId = '507f1f77bcf86cd799439011';
            const token = generateToken(userId);
            const req = { cookies: { token }, headers: {} };
            const res = createMockRes();
            const next = vi.fn();

            await authenticateToken(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Invalid token. User not found.',
            });
        });
    });
});
