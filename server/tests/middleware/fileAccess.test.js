import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import User from '../../models/User.js';
import File from '../../models/File.js';
import { canAccessFile, requireFileDownloadAccess } from '../../middleware/fileAccess.js';

const createMockRes = () => {
    const res = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
};

describe('fileAccess middleware', () => {
    let owner;
    let recipient;
    let stranger;

    beforeEach(async () => {
        owner = await User.create({
            username: 'owner',
            email: 'owner@example.com',
            password: 'password123',
        });
        recipient = await User.create({
            username: 'recipient',
            email: 'recipient@example.com',
            password: 'password123',
        });
        stranger = await User.create({
            username: 'stranger',
            email: 'stranger@example.com',
            password: 'password123',
        });
    });

    const createFile = async (overrides = {}) =>
        File.create({
            filename: 'test.txt',
            originalName: 'test.txt',
            size: 100,
            mimeType: 'text/plain',
            owner: owner._id,
            s3Bucket: 'local-bucket',
            s3Key: `users/${owner._id}/file/test.txt`,
            uploadStatus: 'completed',
            ...overrides,
        });

    describe('canAccessFile', () => {
        it('returns true for the file owner', async () => {
            const file = await createFile();
            expect(await canAccessFile(owner._id, file)).toBe(true);
        });

        it('returns true for a user in sharedWith', async () => {
            const file = await createFile({ sharedWith: [recipient._id] });
            expect(await canAccessFile(recipient._id, file)).toBe(true);
        });

        it('returns false for an unrelated user', async () => {
            const file = await createFile();
            expect(await canAccessFile(stranger._id, file)).toBe(false);
        });

        it('returns false for deleted files', async () => {
            const file = await createFile({ isDeleted: true });
            expect(await canAccessFile(owner._id, file)).toBe(false);
        });

        it('returns false for null file', async () => {
            expect(await canAccessFile(owner._id, null)).toBe(false);
        });
    });

    describe('requireFileDownloadAccess', () => {
        it('attaches file to request and calls next for owner', async () => {
            const file = await createFile();
            const req = { params: { id: file._id.toString() }, user: owner };
            const res = createMockRes();
            const next = vi.fn();

            await requireFileDownloadAccess(req, res, next);

            expect(next).toHaveBeenCalled();
            expect(req.fileRecord._id.toString()).toBe(file._id.toString());
        });

        it('allows access for a shared recipient', async () => {
            const file = await createFile({ sharedWith: [recipient._id] });
            const req = { params: { id: file._id.toString() }, user: recipient };
            const res = createMockRes();
            const next = vi.fn();

            await requireFileDownloadAccess(req, res, next);

            expect(next).toHaveBeenCalled();
            expect(req.fileRecord._id.toString()).toBe(file._id.toString());
        });

        it('returns 403 for an unauthorized user', async () => {
            const file = await createFile();
            const req = { params: { id: file._id.toString() }, user: stranger };
            const res = createMockRes();
            const next = vi.fn();

            await requireFileDownloadAccess(req, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ error: 'Access denied' });
            expect(next).not.toHaveBeenCalled();
        });

        it('returns 404 for a non-existent file', async () => {
            const req = {
                params: { id: new mongoose.Types.ObjectId().toString() },
                user: owner,
            };
            const res = createMockRes();
            const next = vi.fn();

            await requireFileDownloadAccess(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({ error: 'File not found or not ready' });
            expect(next).not.toHaveBeenCalled();
        });

        it('returns 404 for an incomplete upload', async () => {
            const file = await createFile({ uploadStatus: 'uploading' });
            const req = { params: { id: file._id.toString() }, user: owner };
            const res = createMockRes();
            const next = vi.fn();

            await requireFileDownloadAccess(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(next).not.toHaveBeenCalled();
        });

        it('returns 404 for a soft-deleted file', async () => {
            const file = await createFile({ isDeleted: true });
            const req = { params: { id: file._id.toString() }, user: owner };
            const res = createMockRes();
            const next = vi.fn();

            await requireFileDownloadAccess(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(next).not.toHaveBeenCalled();
        });
    });
});
