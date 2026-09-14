import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';

const app = createApp();

describe('health route', () => {
    it('returns ok when MongoDB is connected', async () => {
        const res = await request(app).get('/health');

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
        expect(res.body.checks.mongodb).toBe('connected');
        expect(res.body.checks.storage).toBe('local');
    });
});
