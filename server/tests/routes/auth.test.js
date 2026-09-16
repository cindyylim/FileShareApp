import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';

const app = createApp();

describe('auth routes', () => {
    describe('POST /api/auth/register', () => {
        it('registers a new user and sets auth cookie', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({
                    username: 'newuser',
                    email: 'new@example.com',
                    password: 'password123',
                });

            expect(res.status).toBe(201);
            expect(res.body.message).toBe('User registered successfully');
            expect(res.body.user.username).toBe('newuser');
            expect(res.body.user.email).toBe('new@example.com');
            expect(res.headers['set-cookie']).toBeDefined();
            expect(res.headers['set-cookie'][0]).toMatch(/token=/);
        });

        it('returns 400 when username is missing', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({ email: 'incomplete@example.com', password: 'password123' });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('username, email, and password');
        });

        it('returns 400 when email is missing', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({ username: 'incomplete', password: 'password123' });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('username, email, and password');
        });

        it('returns 400 when password is missing', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({ username: 'incomplete', email: 'incomplete@email.com' });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('username, email, and password');
        });

        it('returns 400 when email is already registered', async () => {
            await request(app)
                .post('/api/auth/register')
                .send({
                    username: 'first',
                    email: 'taken@example.com',
                    password: 'password123',
                });

            const res = await request(app)
                .post('/api/auth/register')
                .send({
                    username: 'second',
                    email: 'taken@example.com',
                    password: 'password123',
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Email already registered');
        });

        it('returns 400 when username is already taken', async () => {
            await request(app)
                .post('/api/auth/register')
                .send({
                    username: 'taken',
                    email: 'taken@example.com',
                    password: 'password123',
                });

            const res = await request(app)
                .post('/api/auth/register')
                .send({
                    username: 'taken',
                    email: 'taken2@example.com',
                    password: 'password123',
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Username already taken');
        });
    });

    describe('POST /api/auth/login', () => {
        beforeEach(async () => {
            await request(app)
                .post('/api/auth/register')
                .send({
                    username: 'loginuser',
                    email: 'login@example.com',
                    password: 'password123',
                });
        });

        it('logs in with valid credentials', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'login@example.com',
                    password: 'password123',
                });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Login successful');
            expect(res.body.user.email).toBe('login@example.com');
            expect(res.body.user.password).toBeUndefined();
        });

        it('returns 400 for missing password', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'login@example.com',
                    password: '',
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Please provide email and password');
        });

        it('returns 400 for missing email', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    email: '',
                    password: 'password123',
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Please provide email and password');
        });

        it('returns 401 for wrong password', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'login@example.com',
                    password: 'wrongpassword',
                });

            expect(res.status).toBe(401);
            expect(res.body.error).toBe('Invalid password');
        });

        it('accepts login with mixed-case email', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'LOGIN@example.com',
                    password: 'password123',
                });

            expect(res.status).toBe(200);
        });

        it('returns 401 for unknown email', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'unknown@example.com',
                    password: 'password123',
                });

            expect(res.status).toBe(401);
            expect(res.body.error).toBe('Invalid email');
        });
    });

    describe('GET /api/auth/me', () => {
        it('returns current user when authenticated', async () => {
            const agent = request.agent(app);

            await agent
                .post('/api/auth/register')
                .send({
                    username: 'meuser',
                    email: 'me@example.com',
                    password: 'password123',
                });

            const res = await agent.get('/api/auth/me');

            expect(res.status).toBe(200);
            expect(res.body.user.email).toBe('me@example.com');
            expect(res.body.user.username).toBe('meuser');
            expect(res.body.user.password).toBeUndefined();
            expect(res.body.user.storageUsed).toBe(0);
            expect(res.body.user.storageQuota).toBe(5 * 1024 * 1024 * 1024);
        });

        it('returns 401 when not authenticated', async () => {
            const res = await request(app).get('/api/auth/me');

            expect(res.status).toBe(401);
        });
    });

    describe('POST /api/auth/logout', () => {
        it('clears the auth cookie', async () => {
            const agent = request.agent(app);

            await agent
                .post('/api/auth/register')
                .send({
                    username: 'logoutuser',
                    email: 'logout@example.com',
                    password: 'password123',
                });

            const res = await agent.post('/api/auth/logout');

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Logged out successfully');
            expect(res.headers['set-cookie'][0]).toMatch(/^token=;/);
        });
    });
});
