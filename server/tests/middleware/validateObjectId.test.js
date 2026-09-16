import { describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import { validateObjectId } from '../../middleware/validateObjectId.js';

const createMockRes = () => {
    const res = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
};

describe('validateObjectId middleware', () => {
    it('calls next for a valid ObjectId', () => {
        const validId = new mongoose.Types.ObjectId().toString();
        const req = { params: { id: validId } };
        const res = createMockRes();
        const next = vi.fn();

        validateObjectId()(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 400 for an invalid ObjectId', () => {
        const req = { params: { id: 'not-an-object-id' } };
        const res = createMockRes();
        const next = vi.fn();

        validateObjectId()(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid id' });
        expect(next).not.toHaveBeenCalled();
    });

    it('returns 400 when the param is missing', () => {
        const req = { params: {} };
        const res = createMockRes();
        const next = vi.fn();

        validateObjectId()(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid id' });
        expect(next).not.toHaveBeenCalled();
    });

    it('validates a custom param name', () => {
        const validUserId = new mongoose.Types.ObjectId().toString();
        const req = { params: { userId: validUserId } };
        const res = createMockRes();
        const next = vi.fn();

        validateObjectId('userId')(req, res, next);

        expect(next).toHaveBeenCalled();
    });

    it('returns 400 with custom param name in error message', () => {
        const req = { params: { userId: 'bad' } };
        const res = createMockRes();
        const next = vi.fn();

        validateObjectId('userId')(req, res, next);

        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid userId' });
    });
});
