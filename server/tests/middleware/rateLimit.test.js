import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authRateLimit } from '../../middleware/rateLimit.js';

const createMockRes = () => {
    const res = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
};

const createReq = (ip = '127.0.0.1', path = '/login') => ({
    ip,
    path,
});

describe('authRateLimit middleware', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('calls next when under the request limit', () => {
        const req = createReq('10.0.0.1', '/register');
        const res = createMockRes();
        const next = vi.fn();

        authRateLimit(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 429 when the limit is exceeded', () => {
        const req = createReq('10.0.0.2', '/login');
        const res = createMockRes();
        const next = vi.fn();

        for (let i = 0; i < 100; i++) {
            authRateLimit(req, res, next);
        }

        authRateLimit(req, res, next);

        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Too many requests. Please try again later.',
        });
        expect(next).toHaveBeenCalledTimes(100);
    });

    it('tracks limits separately per IP and path', () => {
        const res = createMockRes();
        const next = vi.fn();

        for (let i = 0; i < 101; i++) {
            authRateLimit(createReq('10.0.0.3', '/login'), res, next);
        }

        const otherPathRes = createMockRes();
        const otherPathNext = vi.fn();
        authRateLimit(createReq('10.0.0.3', '/register'), otherPathRes, otherPathNext);

        expect(otherPathNext).toHaveBeenCalled();
        expect(otherPathRes.status).not.toHaveBeenCalled();
    });

    it('resets the counter after the window expires', () => {
        const req = createReq('10.0.0.4', '/login');
        const res = createMockRes();
        const next = vi.fn();

        for (let i = 0; i < 100; i++) {
            authRateLimit(req, res, next);
        }

        vi.advanceTimersByTime(15 * 60 * 1000 + 1);

        const freshRes = createMockRes();
        const freshNext = vi.fn();
        authRateLimit(req, freshRes, freshNext);

        expect(freshNext).toHaveBeenCalled();
        expect(freshRes.status).not.toHaveBeenCalled();
    });
});
