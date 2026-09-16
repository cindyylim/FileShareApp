import { describe, it, expect, beforeEach } from 'vitest';
import File from '../../models/File.js';
import User from '../../models/User.js';

describe('File model', () => {
    let owner;

    beforeEach(async () => {
        owner = await User.create({
            username: 'fileowner',
            email: 'owner@example.com',
            password: 'password123',
        });
    });

    const createFileData = (overrides = {}) => ({
        filename: 'document.pdf',
        originalName: 'document.pdf',
        size: 1024,
        mimeType: 'application/pdf',
        owner: owner._id,
        s3Bucket: 'test-bucket',
        s3Key: `users/${owner._id}/${Date.now()}-document.pdf`,
        ...overrides,
    });

    it('creates a file with default values', async () => {
        const file = await File.create(createFileData());

        expect(file.path).toBe('/');
        expect(file.version).toBe(1);
        expect(file.isDeleted).toBe(false);
        expect(file.isCompressed).toBe(false);
        expect(file.uploadStatus).toBe('pending');
        expect(file.chunks).toEqual([]);
        expect(file.sharedWith).toEqual([]);
        expect(file.createdAt).toBeInstanceOf(Date);
        expect(file.updatedAt).toBeInstanceOf(Date);
    });

    it('trims whitespace from filename', async () => {
        const file = await File.create(createFileData({
            filename: '  report.pdf  ',
            s3Key: `users/${owner._id}/trimmed-report.pdf`,
        }));

        expect(file.filename).toBe('report.pdf');
    });

    it('stores chunk metadata', async () => {
        const file = await File.create(createFileData({
            s3Key: `users/${owner._id}/chunked.bin`,
            chunks: [{
                partNumber: 1,
                etag: '"abc123"',
                size: 512,
                s3Key: `users/${owner._id}/chunked.bin`,
                fingerprint: 'sha256-fingerprint',
            }],
        }));

        expect(file.chunks).toHaveLength(1);
        expect(file.chunks[0].partNumber).toBe(1);
        expect(file.chunks[0].fingerprint).toBe('sha256-fingerprint');
    });

    it('stores compression metadata', async () => {
        const file = await File.create(createFileData({
            s3Key: `users/${owner._id}/compressed.txt`,
            isCompressed: true,
            originalSize: 5000,
            size: 1200,
        }));

        expect(file.isCompressed).toBe(true);
        expect(file.originalSize).toBe(5000);
        expect(file.size).toBe(1200);
    });

    it('stores content hash for deduplication', async () => {
        const hash = 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3';
        const file = await File.create(createFileData({
            s3Key: `users/${owner._id}/hashed.bin`,
            hash,
            uploadStatus: 'completed',
        }));

        expect(file.hash).toBe(hash);
    });

    it('tracks shared users', async () => {
        const recipient = await User.create({
            username: 'recipient',
            email: 'recipient@example.com',
            password: 'password123',
        });

        const file = await File.create(createFileData({
            s3Key: `users/${owner._id}/shared.txt`,
            sharedWith: [recipient._id],
        }));

        expect(file.sharedWith).toHaveLength(1);
        expect(file.sharedWith[0].toString()).toBe(recipient._id.toString());
    });

    it('getS3Key returns the stored object key', async () => {
        const s3Key = `users/${owner._id}/get-key-test.txt`;
        const file = await File.create(createFileData({ s3Key }));

        expect(file.getS3Key()).toBe(s3Key);
    });

    it('rejects missing required fields', async () => {
        await expect(File.create({
            filename: 'incomplete.txt',
            owner: owner._id,
        })).rejects.toThrow();
    });

    it('rejects invalid uploadStatus values', async () => {
        await expect(File.create(createFileData({
            s3Key: `users/${owner._id}/bad-status.txt`,
            uploadStatus: 'invalid',
        }))).rejects.toThrow();
    });

    it('accepts all valid uploadStatus values', async () => {
        const statuses = ['pending', 'uploading', 'completed', 'failed'];

        for (const status of statuses) {
            const file = await File.create(createFileData({
                s3Key: `users/${owner._id}/status-${status}.txt`,
                uploadStatus: status,
            }));
            expect(file.uploadStatus).toBe(status);
        }
    });

    it('rejects duplicate s3Key', async () => {
        const s3Key = `users/${owner._id}/unique-key.txt`;

        await File.create(createFileData({ s3Key }));

        await expect(File.create(createFileData({
            filename: 'other.txt',
            s3Key,
        }))).rejects.toThrow();
    });

    it('rejects chunks missing required fields', async () => {
        await expect(File.create(createFileData({
            s3Key: `users/${owner._id}/bad-chunk.bin`,
            chunks: [{ partNumber: 1 }],
        }))).rejects.toThrow();
    });
});
