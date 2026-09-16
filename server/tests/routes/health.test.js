import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';

const app = createApp();

describe('health route', () => {
    let temp;
    beforeEach(() => {
        temp = process.env.USE_LOCAL_STORAGE;
    });
    afterEach(() => {
        process.env.USE_LOCAL_STORAGE = temp;
    });

    it('returns ok when MongoDB is connected', async () => {
        process.env.USE_LOCAL_STORAGE = 'true';
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
        expect(res.body.checks.mongodb).toBe('connected');
        expect(res.body.checks.storage).toBe('local');
    });
    it('returns ok when MongoDB is connected', async () => {
        process.env.USE_LOCAL_STORAGE = 'false';
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
        expect(res.body.checks.mongodb).toBe('connected');
        expect(res.body.checks.storage).toBe('s3');
        process.env.USE_LOCAL_STORAGE = 'true';
    });
});
