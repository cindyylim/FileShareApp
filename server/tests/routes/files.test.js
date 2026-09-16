import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { createApp } from '../../app.js';
import File from '../../models/File.js';
import User from '../../models/User.js';

const app = createApp();

const registerAndLogin = async (agent, user = {}) => {
    const defaults = {
        username: 'fileuser',
        email: 'files@example.com',
        password: 'password123',
    };
    const data = { ...defaults, ...user };
    await agent.post('/api/auth/register').send(data);
    return data;
};

describe('files routes', () => {
    beforeEach(async () => {
        const uploadDir = process.env.LOCAL_STORAGE_DIR || './test-uploads';
        if (fs.existsSync(uploadDir)) {
            fs.rmSync(uploadDir, { recursive: true, force: true });
        }
    });

    describe('POST /api/files/init-upload', () => {
        it('initializes upload for authenticated user', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent);

            const res = await agent
                .post('/api/files/init-upload')
                .send({
                    filename: 'test.txt',
                    size: 1024,
                    mimeType: 'text/plain',
                });

            expect(res.status).toBe(201);
            expect(res.body.fileId).toBeDefined();
            expect(res.body.uploadId).toBeDefined();
            expect(res.body.chunkSize).toBe(5 * 1024 * 1024);
        });

        it('returns 400 when required fields are missing', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent);

            const res = await agent
                .post('/api/files/init-upload')
                .send({ filename: 'test.txt' });

            expect(res.status).toBe(400);
        });

        it('returns 403 when storage quota is exceeded', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, { email: 'quota@example.com', username: 'quotauser' });

            const user = await User.findOne({ email: 'quota@example.com' });
            user.storageUsed = user.storageQuota;
            await user.save();

            const res = await agent
                .post('/api/files/init-upload')
                .send({
                    filename: 'huge.bin',
                    size: 1024,
                    mimeType: 'application/octet-stream',
                });

            expect(res.status).toBe(403);
            expect(res.body.error).toBe('Storage quota exceeded');
        });

        it('returns 401 when not authenticated', async () => {
            const res = await request(app)
                .post('/api/files/init-upload')
                .send({
                    filename: 'test.txt',
                    size: 1024,
                    mimeType: 'text/plain',
                });

            expect(res.status).toBe(401);
        });
    });

    describe('GET /api/files', () => {
        it('lists user files with pagination', async () => {
            const agent = request.agent(app);
            const userData = await registerAndLogin(agent, {
                email: 'list@example.com',
                username: 'listuser',
            });

            const user = await User.findOne({ email: userData.email });

            await File.create({
                filename: 'doc.pdf',
                originalName: 'doc.pdf',
                size: 500,
                mimeType: 'application/pdf',
                owner: user._id,
                s3Bucket: 'local-bucket',
                s3Key: `users/${user._id}/file1/doc.pdf`,
                uploadStatus: 'completed',
            });

            const res = await agent.get('/api/files');

            expect(res.status).toBe(200);
            expect(res.body.files).toHaveLength(1);
            expect(res.body.files[0].filename).toBe('doc.pdf');
            expect(res.body.pagination.total).toBe(1);
        });
    });

    describe('POST /api/files/:id/share', () => {
        it('shares a file with another user', async () => {
            const ownerAgent = request.agent(app);
            const recipientAgent = request.agent(app);

            await registerAndLogin(ownerAgent, {
                email: 'owner@example.com',
                username: 'owner',
            });
            await registerAndLogin(recipientAgent, {
                email: 'recipient@example.com',
                username: 'recipient',
            });

            const owner = await User.findOne({ email: 'owner@example.com' });
            const file = await File.create({
                filename: 'shared.txt',
                originalName: 'shared.txt',
                size: 100,
                mimeType: 'text/plain',
                owner: owner._id,
                s3Bucket: 'local-bucket',
                s3Key: `users/${owner._id}/file2/shared.txt`,
                uploadStatus: 'completed',
            });

            const res = await ownerAgent
                .post(`/api/files/${file._id}/share`)
                .send({ email: 'recipient@example.com' });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('File shared successfully');
            expect(res.body.sharedWith.email).toBe('recipient@example.com');

            const updatedFile = await File.findById(file._id);
            expect(updatedFile.sharedWith).toHaveLength(1);
        });

        it('prevents sharing with yourself', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, { email: 'self@example.com', username: 'selfuser' });

            const user = await User.findOne({ email: 'self@example.com' });
            const file = await File.create({
                filename: 'solo.txt',
                originalName: 'solo.txt',
                size: 100,
                mimeType: 'text/plain',
                owner: user._id,
                s3Bucket: 'local-bucket',
                s3Key: `users/${user._id}/file3/solo.txt`,
                uploadStatus: 'completed',
            });

            const res = await agent
                .post(`/api/files/${file._id}/share`)
                .send({ email: 'self@example.com' });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Cannot share file with yourself');
        });
    });

    describe('DELETE /api/files/:id', () => {
        it('deletes an owned file', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, { email: 'delete@example.com', username: 'deleteuser' });

            const user = await User.findOne({ email: 'delete@example.com' });
            const file = await File.create({
                filename: 'todelete.txt',
                originalName: 'todelete.txt',
                size: 200,
                mimeType: 'text/plain',
                owner: user._id,
                s3Bucket: 'local-bucket',
                s3Key: `users/${user._id}/file4/todelete.txt`,
                uploadStatus: 'completed',
            });

            const res = await agent.delete(`/api/files/${file._id}`);

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('File deleted successfully');

            const deleted = await File.findById(file._id);
            expect(deleted.isDeleted).toBe(true);
            expect(deleted.sharedWith).toHaveLength(0);
        });
    });

    describe('POST /api/files/record-chunk', () => {
        it('rejects chunk recording when using local storage', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, { email: 'chunk@example.com', username: 'chunkuser' });

            const initRes = await agent.post('/api/files/init-upload').send({
                filename: 'chunked.bin',
                size: 1024,
                mimeType: 'application/octet-stream',
            });

            const { fileId, uploadId } = initRes.body;

            const res = await agent.post('/api/files/record-chunk').send({
                fileId,
                uploadId,
                partNumber: 1,
                etag: '"abc123"',
                size: 512,
                fingerprint: 'fp1',
            });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('S3');
        });
    });

    describe('POST /api/files/:id/abort-upload', () => {
        it('aborts an in-progress upload', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, { email: 'abort@example.com', username: 'abortuser' });

            const initRes = await agent.post('/api/files/init-upload').send({
                filename: 'abortme.txt',
                size: 100,
                mimeType: 'text/plain',
            });

            const res = await agent.post(`/api/files/${initRes.body.fileId}/abort-upload`);
            expect(res.status).toBe(200);

            const file = await File.findById(initRes.body.fileId);
            expect(file).toBeNull();
        });
    });
});
