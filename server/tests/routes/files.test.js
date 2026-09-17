import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createApp } from '../../app.js';
import { S3_CONFIG, LOCAL_STORAGE_DIR } from '../../config/s3.js';
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
        process.env.USE_LOCAL_STORAGE = 'true';
        const uploadDir = './test-uploads';
        process.env.LOCAL_STORAGE_DIR = uploadDir;
        if (fs.existsSync(uploadDir)) {
            fs.rmSync(uploadDir, { recursive: true, force: true });
        }
        await fs.promises.mkdir(uploadDir, { recursive: true });
    });

    describe('POST /api/files/init-upload', () => {
        it('initializes upload for authenticated user', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent);

            const res = await agent
                .post('/api/files/init-upload')
                .send({
                    filename: 'test.txt',
                    size: 1,
                    originalSize: 1,
                    mimeType: 'text/plain',
                });

            expect(res.status).toBe(201);
            expect(res.body.fileId).toBeDefined();
            expect(res.body.uploadId).toBeDefined();
            expect(res.body.s3Key).toBeDefined();
            expect(res.body.useLocalStorage).toBe(true);
            expect(res.body.chunkSize).toBe(5 * 1024 * 1024);
        });

        it('initializes upload for authenticated user when size is max size', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent);

            const res = await agent
                .post('/api/files/init-upload')
                .send({
                    filename: 'test.txt',
                    size: S3_CONFIG.MAX_FILE_SIZE,
                    originalSize: S3_CONFIG.MAX_FILE_SIZE,
                    mimeType: 'text/plain',
                });

            expect(res.status).toBe(201);
            expect(res.body.fileId).toBeDefined();
            expect(res.body.uploadId).toBeDefined();
            expect(res.body.s3Key).toBeDefined();
            expect(res.body.useLocalStorage).toBe(true);
            expect(res.body.chunkSize).toBe(5 * 1024 * 1024);
        });

        it('returns 400 when mimeType field is missing', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent);

            const res = await agent
                .post('/api/files/init-upload')
                .send({ 
                    filename: 'test.txt',
                    size: 1024, 
                    originalSize: 5000,
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Please provide filename, size, originalSize, and mimeType');
        });

        it('returns 400 when filename is missing', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent);

            const res = await agent
                .post('/api/files/init-upload')
                .send({
                    size: 1024,
                    originalSize: 1024,
                    mimeType: 'text/plain',
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Please provide filename, size, originalSize, and mimeType');
        });

        it('returns 400 when size is missing', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent);

            const res = await agent
                .post('/api/files/init-upload')
                .send({
                    filename: 'test.txt',
                    originalSize: 1024,
                    mimeType: 'text/plain',
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Please provide filename, size, originalSize, and mimeType');
        });

        it('returns 400 when originalSize is missing', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent);

            const res = await agent
                .post('/api/files/init-upload')
                .send({
                    filename: 'test.txt',
                    size: 1024,
                    mimeType: 'text/plain',
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Please provide filename, size, originalSize, and mimeType');
        });

        it('returns 400 when sanitizeFilename rejects the filename', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent);

            const res = await agent
                .post('/api/files/init-upload')
                .send({
                    filename: '..',
                    size: 1024,
                    originalSize: 1024,
                    mimeType: 'text/plain',
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Invalid filename');
        });

        it('returns 400 when size is less than 0', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent);

            const res = await agent
                .post('/api/files/init-upload')
                .send({
                    filename: 'test.txt',
                    size: -1,
                    originalSize: 1024,
                    mimeType: 'text/plain',
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe(
                `File size must be a number between 1 byte and ${S3_CONFIG.MAX_FILE_SIZE} bytes`
            );
        });

        it('returns 400 when size is greater than S3_CONFIG.MAX_FILE_SIZE', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent);

            const res = await agent
                .post('/api/files/init-upload')
                .send({
                    filename: 'test.txt',
                    size: S3_CONFIG.MAX_FILE_SIZE + 1,
                    originalSize: S3_CONFIG.MAX_FILE_SIZE + 1,
                    mimeType: 'text/plain',
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe(
                `File size must be a number between 1 byte and ${S3_CONFIG.MAX_FILE_SIZE} bytes`
            );
        });

        it('returns 400 when originalSize is less than 0', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent);

            const res = await agent
                .post('/api/files/init-upload')
                .send({
                    filename: 'test.txt',
                    size: 1024,
                    originalSize: -1,
                    mimeType: 'text/plain',
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe(
                `Original size must be a number between 1 byte and ${S3_CONFIG.MAX_FILE_SIZE} bytes`
            );
        });

        it('returns 400 when originalSize is greater than S3_CONFIG.MAX_FILE_SIZE', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent);

            const res = await agent
                .post('/api/files/init-upload')
                .send({
                    filename: 'test.txt',
                    size: 1024,
                    originalSize: S3_CONFIG.MAX_FILE_SIZE + 1,
                    mimeType: 'text/plain',
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe(
                `Original size must be a number between 1 byte and ${S3_CONFIG.MAX_FILE_SIZE} bytes`
            );
        });

        it('returns 400 when originalSize is not a number', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent);

            const res = await agent
                .post('/api/files/init-upload')
                .send({ filename: 'test.txt', size: 1024, originalSize: 'not a number', mimeType: 'text/plain' });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Original size must be a number between 1 byte and 5368709120 bytes');
        });

        it('returns 400 when size is not a number', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent);

            const res = await agent
                .post('/api/files/init-upload')
                .send({ filename: 'test.txt', size: 'not a number', originalSize: 5000, mimeType: 'text/plain' });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('File size must be a number between 1 byte and 5368709120 bytes');
        });

        it('returns 400 when size is greater than originalSize', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent);

            const res = await agent
                .post('/api/files/init-upload')
                .send({ filename: 'test.txt', size: 5001, originalSize: 5000, mimeType: 'text/plain' });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('File size cannot be greater than original size');
        });

        it('returns 403 when storage quota is exceeded', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, { email: 'quota@example.com', username: 'quotauser' });

            const user = await User.findOne({ email: 'quota@example.com' });
            user.storageUsed = user.storageQuota - 1024;
            await user.save();

            const res = await agent
                .post('/api/files/init-upload')
                .send({
                    filename: 'huge.bin',
                    size: 1025,
                    originalSize: 1025,
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
                    originalSize: 1024,
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

        it('skips to the second page when page and limit are set', async () => {
            const agent = request.agent(app);
            const userData = await registerAndLogin(agent, {
                email: 'page2@example.com',
                username: 'page2user',
            });

            const user = await User.findOne({ email: userData.email });
            const now = new Date();

            await File.create([
                {
                    filename: 'oldest.txt',
                    originalName: 'oldest.txt',
                    size: 10,
                    mimeType: 'text/plain',
                    owner: user._id,
                    s3Bucket: 'local-bucket',
                    s3Key: `users/${user._id}/page/oldest.txt`,
                    uploadStatus: 'completed',
                    createdAt: new Date(now.getTime() - 3000),
                },
                {
                    filename: 'middle.txt',
                    originalName: 'middle.txt',
                    size: 20,
                    mimeType: 'text/plain',
                    owner: user._id,
                    s3Bucket: 'local-bucket',
                    s3Key: `users/${user._id}/page/middle.txt`,
                    uploadStatus: 'completed',
                    createdAt: new Date(now.getTime() - 2000),
                },
                {
                    filename: 'newest.txt',
                    originalName: 'newest.txt',
                    size: 30,
                    mimeType: 'text/plain',
                    owner: user._id,
                    s3Bucket: 'local-bucket',
                    s3Key: `users/${user._id}/page/newest.txt`,
                    uploadStatus: 'completed',
                    createdAt: new Date(now.getTime() - 1000),
                },
            ]);

            const res = await agent.get('/api/files').query({ page: 2, limit: 2 });

            expect(res.status).toBe(200);
            expect(res.body.files).toHaveLength(1);
            expect(res.body.files[0].filename).toBe('oldest.txt');
            expect(res.body.pagination).toMatchObject({
                page: 2,
                limit: 2,
                total: 3,
                pages: 2,
            });
        });
    });

    describe('GET /api/files/shared', () => {
        it('lists files shared with the current user', async () => {
            const ownerAgent = request.agent(app);
            const recipientAgent = request.agent(app);

            await registerAndLogin(ownerAgent, {
                email: 'share-owner@example.com',
                username: 'shareowner',
            });
            await registerAndLogin(recipientAgent, {
                email: 'share-recipient@example.com',
                username: 'sharerecipient',
            });

            const owner = await User.findOne({ email: 'share-owner@example.com' });
            const file = await File.create({
                filename: 'shared-list.txt',
                originalName: 'shared-list.txt',
                size: 100,
                mimeType: 'text/plain',
                owner: owner._id,
                s3Bucket: 'local-bucket',
                s3Key: `users/${owner._id}/shared/shared-list.txt`,
                uploadStatus: 'completed',
            });

            const shareRes = await ownerAgent
                .post(`/api/files/${file._id}/share`)
                .send({ email: 'share-recipient@example.com' });
            expect(shareRes.status).toBe(200);

            const res = await recipientAgent.get('/api/files/shared');

            expect(res.status).toBe(200);
            expect(res.body.files).toHaveLength(1);
            expect(res.body.files[0].filename).toBe('shared-list.txt');
            expect(res.body.files[0].owner.email).toBe('share-owner@example.com');
            expect(res.body.pagination).toMatchObject({
                page: 1,
                total: 1,
                pages: 1,
            });
        });

        it('skips to the second page when page and limit are set', async () => {
            const ownerAgent = request.agent(app);
            const recipientAgent = request.agent(app);

            await registerAndLogin(ownerAgent, {
                email: 'share-page-owner@example.com',
                username: 'sharepageowner',
            });
            await registerAndLogin(recipientAgent, {
                email: 'share-page-recipient@example.com',
                username: 'sharepagerecipient',
            });

            const owner = await User.findOne({ email: 'share-page-owner@example.com' });
            const now = new Date();

            const files = await File.create([
                {
                    filename: 'oldest-shared.txt',
                    originalName: 'oldest-shared.txt',
                    size: 10,
                    mimeType: 'text/plain',
                    owner: owner._id,
                    s3Bucket: 'local-bucket',
                    s3Key: `users/${owner._id}/shared-page/oldest.txt`,
                    uploadStatus: 'completed',
                    createdAt: new Date(now.getTime() - 3000),
                },
                {
                    filename: 'middle-shared.txt',
                    originalName: 'middle-shared.txt',
                    size: 20,
                    mimeType: 'text/plain',
                    owner: owner._id,
                    s3Bucket: 'local-bucket',
                    s3Key: `users/${owner._id}/shared-page/middle.txt`,
                    uploadStatus: 'completed',
                    createdAt: new Date(now.getTime() - 2000),
                },
                {
                    filename: 'newest-shared.txt',
                    originalName: 'newest-shared.txt',
                    size: 30,
                    mimeType: 'text/plain',
                    owner: owner._id,
                    s3Bucket: 'local-bucket',
                    s3Key: `users/${owner._id}/shared-page/newest.txt`,
                    uploadStatus: 'completed',
                    createdAt: new Date(now.getTime() - 1000),
                },
            ]);

            for (const file of files) {
                const shareRes = await ownerAgent
                    .post(`/api/files/${file._id}/share`)
                    .send({ email: 'share-page-recipient@example.com' });
                expect(shareRes.status).toBe(200);
            }

            const res = await recipientAgent.get('/api/files/shared').query({ page: 2, limit: 2 });

            expect(res.status).toBe(200);
            expect(res.body.files).toHaveLength(1);
            expect(res.body.files[0].filename).toBe('oldest-shared.txt');
            expect(res.body.pagination).toMatchObject({
                page: 2,
                limit: 2,
                total: 3,
                pages: 2,
            });
        });
    });

    describe('POST /api/files/presigned-url', () => {
        it('returns a local upload URL when using local storage', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 'presign@example.com',
                username: 'presignuser',
            });

            const initRes = await agent.post('/api/files/init-upload').send({
                filename: 'presign.txt',
                size: 100,
                originalSize: 100,
                mimeType: 'text/plain',
            });
            const { fileId, uploadId } = initRes.body;

            const res = await agent.post('/api/files/presigned-url').send({
                fileId,
                uploadId,
                partNumber: 1,
            });

            expect(res.status).toBe(200);
            expect(res.body.useLocalStorage).toBe(true);
            expect(res.body.partNumber).toBe(1);
            expect(res.body.presignedUrl).toBe(
                `/api/files/local-upload?fileId=${fileId}&uploadId=${uploadId}&partNumber=1`
            );
        });

        it('returns 400 when required fields are missing', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 'presign-missing@example.com',
                username: 'presignmissing',
            });

            const missingUploadId = await agent.post('/api/files/presigned-url').send({
                fileId: 'abc',
                partNumber: 1,
            });

            expect(missingUploadId.status).toBe(400);
            expect(missingUploadId.body.error).toBe('Please provide fileId, partNumber, and uploadId');

            const missingPartNumber = await agent.post('/api/files/presigned-url').send({
                fileId: 'abc',
                uploadId: 'abc',
            });

            expect(missingPartNumber.status).toBe(400);
            expect(missingPartNumber.body.error).toBe('Please provide fileId, partNumber, and uploadId');

            const missingFileId = await agent.post('/api/files/presigned-url').send({
                partNumber: 1,
                uploadId: 'abc',
            });

            expect(missingFileId.status).toBe(400);
            expect(missingFileId.body.error).toBe('Please provide fileId, partNumber, and uploadId');
        });

        it('returns 404 when the upload is not an active upload', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 'presign-404@example.com',
                username: 'presign404',
            });

            const user = await User.findOne({ email: 'presign-404@example.com' });
            const file = await File.create({
                filename: 'done.txt',
                originalName: 'done.txt',
                size: 50,
                mimeType: 'text/plain',
                owner: user._id,
                s3Bucket: 'local-bucket',
                s3Key: `users/${user._id}/presign/done.txt`,
                uploadId: 'stale-upload',
                uploadStatus: 'completed',
            });

            const res = await agent.post('/api/files/presigned-url').send({
                fileId: file._id,
                uploadId: 'stale-upload',
                partNumber: 1,
            });

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('File not found or unauthorized');
        });

        it('returns 404 when the upload is not an owned upload', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 'presign-404@example.com',
                username: 'presign404',
            });
            const ownerId = '66e6e6e6e6e6e6e6e6e6e6e6';
            const file = await File.create({
                filename: 'done.txt',
                originalName: 'done.txt',
                size: 50,
                mimeType: 'text/plain',
                owner: ownerId,
                s3Bucket: 'local-bucket',
                s3Key: `users/${ownerId}/presign/done.txt`,
                uploadId: 'upload',
                uploadStatus: 'completed',
            });

            const res = await agent.post('/api/files/presigned-url').send({
                fileId: file._id,
                uploadId: 'upload',
                partNumber: 1,
            });

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('File not found or unauthorized');
        });

        it('returns 401 when not authenticated', async () => {
            const res = await request(app).post('/api/files/presigned-url').send({
                fileId: 'abc',
                uploadId: 'def',
                partNumber: 1,
            });

            expect(res.status).toBe(401);
        });
    });

    describe('PUT /api/files/local-upload', () => {
        it('saves a chunk and returns an ETag', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 'localupload@example.com',
                username: 'localuploaduser',
            });

            const initRes = await agent.post('/api/files/init-upload').send({
                filename: 'chunk.txt',
                size: 100,
                originalSize: 100,
                mimeType: 'text/plain',
            });
            const { fileId, uploadId } = initRes.body;
            const payload = Buffer.from('chunk-bytes');

            const res = await agent
                .put('/api/files/local-upload')
                .query({ fileId, uploadId, partNumber: 1 })
                .set('Content-Type', 'application/octet-stream')
                .set('x-chunk-fingerprint', 'fp-chunk-1')
                .send(payload);

            expect(res.status).toBe(200);
            expect(res.text).toBe('OK');
            const expectedEtag = `"${crypto.createHash('md5').update(payload).digest('hex')}"`;
            expect(res.headers.etag).toBe(expectedEtag);

            const chunkPath = path.join(LOCAL_STORAGE_DIR, 'chunks', fileId, 'part-1');
            expect(fs.existsSync(chunkPath)).toBe(true);
            expect(await fs.promises.readFile(chunkPath)).toEqual(payload);

            const file = await File.findById(fileId);
            expect(file.chunks).toHaveLength(1);
            expect(file.chunks[0]).toMatchObject({
                partNumber: 1,
                etag: expectedEtag,
                size: payload.length,
                fingerprint: 'fp-chunk-1',
            });
        });

        it('updates metadata when the same part number is uploaded again', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 'localupload-update@example.com',
                username: 'localuploadupdate',
            });

            const initRes = await agent.post('/api/files/init-upload').send({
                filename: 'retry.txt',
                size: 100,
                originalSize: 100,
                mimeType: 'text/plain',
            });
            const { fileId, uploadId } = initRes.body;

            await agent
                .put('/api/files/local-upload')
                .query({ fileId, uploadId, partNumber: 1 })
                .set('Content-Type', 'application/octet-stream')
                .set('x-chunk-fingerprint', 'fp-old')
                .send(Buffer.from('old-chunk'));

            const payload = Buffer.from('new-chunk-data');
            const res = await agent
                .put('/api/files/local-upload')
                .query({ fileId, uploadId, partNumber: 1 })
                .set('Content-Type', 'application/octet-stream')
                .set('x-chunk-fingerprint', 'fp-new')
                .send(payload);

            expect(res.status).toBe(200);
            const expectedEtag = `"${crypto.createHash('md5').update(payload).digest('hex')}"`;
            expect(res.headers.etag).toBe(expectedEtag);

            const file = await File.findById(fileId);
            expect(file.chunks).toHaveLength(1);
            expect(file.chunks[0]).toMatchObject({
                partNumber: 1,
                etag: expectedEtag,
                size: payload.length,
                fingerprint: 'fp-new',
            });

            const chunkPath = path.join(LOCAL_STORAGE_DIR, 'chunks', fileId, 'part-1');
            expect(await fs.promises.readFile(chunkPath)).toEqual(payload);
        });

        it('returns 400 when query parameters are missing', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 'localupload-missing@example.com',
                username: 'localuploadmissing',
            });

            const missingUploadId = await agent
                .put('/api/files/local-upload')
                .query({ fileId: 'abc', partNumber: 1 })
                .set('Content-Type', 'application/octet-stream')
                .send(Buffer.from('data'));

            expect(missingUploadId.status).toBe(400);
            expect(missingUploadId.body.error).toBe('Missing fileId, partNumber, or uploadId query parameters');

            const missingPartNumber = await agent
                .put('/api/files/local-upload')
                .query({ fileId: 'abc', uploadId: 'abc' })
                .set('Content-Type', 'application/octet-stream')
                .send(Buffer.from('data'));

            expect(missingPartNumber.status).toBe(400);
            expect(missingPartNumber.body.error).toBe('Missing fileId, partNumber, or uploadId query parameters');

            const missingFileId = await agent
                .put('/api/files/local-upload')
                .query({ partNumber: 1, uploadId: 'abc' })
                .set('Content-Type', 'application/octet-stream')
                .send(Buffer.from('data'));

            expect(missingFileId.status).toBe(400);
            expect(missingFileId.body.error).toBe('Missing fileId, partNumber, or uploadId query parameters');
        });

        it('returns 404 when the upload is not an active upload', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 'localupload-inactive@example.com',
                username: 'localuploadinactive',
            });

            const user = await User.findOne({ email: 'localupload-inactive@example.com' });
            const file = await File.create({
                filename: 'done.txt',
                originalName: 'done.txt',
                size: 50,
                mimeType: 'text/plain',
                owner: user._id,
                s3Bucket: 'local-bucket',
                s3Key: `users/${user._id}/localupload/done.txt`,
                uploadId: 'stale-upload',
                uploadStatus: 'completed',
            });

            const res = await agent
                .put('/api/files/local-upload')
                .query({ fileId: file._id.toString(), uploadId: 'stale-upload', partNumber: 1 })
                .set('Content-Type', 'application/octet-stream')
                .send(Buffer.from('data'));

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('File not found or unauthorized');
        });

        it('returns 404 when the upload is not owned', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 'localupload-other@example.com',
                username: 'localuploadother',
            });

            const ownerId = '66e6e6e6e6e6e6e6e6e6e6e6';
            const file = await File.create({
                filename: 'other.txt',
                originalName: 'other.txt',
                size: 50,
                mimeType: 'text/plain',
                owner: ownerId,
                s3Bucket: 'local-bucket',
                s3Key: `users/${ownerId}/localupload/other.txt`,
                uploadId: 'upload',
                uploadStatus: 'uploading',
            });

            const res = await agent
                .put('/api/files/local-upload')
                .query({ fileId: file._id.toString(), uploadId: 'upload', partNumber: 1 })
                .set('Content-Type', 'application/octet-stream')
                .send(Buffer.from('data'));

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('File not found or unauthorized');
        });

        it('returns 404 when local storage is not enabled', async () => {
            process.env.USE_LOCAL_STORAGE = 'false';
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 'localupload-disabled@example.com',
                username: 'localuploaddisabled',
            });

            const res = await agent
                .put('/api/files/local-upload')
                .query({ fileId: 'abc', uploadId: 'abc', partNumber: 1 })
                .set('Content-Type', 'application/octet-stream')
                .send(Buffer.from('data'));

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('Local storage is not enabled');
        });

        it('returns 401 when not authenticated', async () => {
            const res = await request(app)
                .put('/api/files/local-upload')
                .query({ fileId: 'abc', uploadId: 'abc', partNumber: 1 })
                .set('Content-Type', 'application/octet-stream')
                .send(Buffer.from('data'));

            expect(res.status).toBe(401);
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

    describe('DELETE /api/files/:id/unshare/:userId', () => {
        it('unshares a file with a specific user', async () => {
            const ownerAgent = request.agent(app);
            const recipientAgent = request.agent(app);

            await registerAndLogin(ownerAgent, {
                email: 'unshare-owner@example.com',
                username: 'unshareowner',
            });
            await registerAndLogin(recipientAgent, {
                email: 'unshare-recipient@example.com',
                username: 'unsharerecipient',
            });

            const owner = await User.findOne({ email: 'unshare-owner@example.com' });
            const recipient = await User.findOne({ email: 'unshare-recipient@example.com' });
            const file = await File.create({
                filename: 'unshare-me.txt',
                originalName: 'unshare-me.txt',
                size: 100,
                mimeType: 'text/plain',
                owner: owner._id,
                s3Bucket: 'local-bucket',
                s3Key: `users/${owner._id}/unshare/unshare-me.txt`,
                uploadStatus: 'completed',
            });

            const shareRes = await ownerAgent
                .post(`/api/files/${file._id}/share`)
                .send({ email: 'unshare-recipient@example.com' });
            expect(shareRes.status).toBe(200);

            const res = await ownerAgent.delete(`/api/files/${file._id}/unshare/${recipient._id}`);

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('File unshared successfully');

            const updatedFile = await File.findById(file._id);
            expect(updatedFile.sharedWith).toHaveLength(0);

            const updatedRecipient = await User.findById(recipient._id);
            expect(updatedRecipient.sharedFiles.map(String)).not.toContain(file._id.toString());
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
                originalSize: 1024,
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
            expect(res.body.error).toBe('Chunk recording is only used for S3 uploads');
        });
    });

    describe('POST /api/files/complete-upload', () => {
        it('returns idempotent success when upload is already completed', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, { email: 'complete@example.com', username: 'completeuser' });

            const user = await User.findOne({ email: 'complete@example.com' });
            const file = await File.create({
                filename: 'done.txt',
                originalName: 'done.txt',
                size: 50,
                mimeType: 'text/plain',
                owner: user._id,
                s3Bucket: 'local-bucket',
                s3Key: `users/${user._id}/done/done.txt`,
                uploadStatus: 'completed',
            });

            const res = await agent.post('/api/files/complete-upload').send({
                fileId: file._id,
                uploadId: 'stale-upload-id',
                parts: [{ partNumber: 1, etag: '"abc"', size: 50 }],
            });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Upload already completed');
            expect(res.body.file.id).toBe(file._id.toString());
        });

        it('completes a local upload and assembles the file', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 'complete-success@example.com',
                username: 'completesuccess',
            });

            const payload = Buffer.from('complete-me');
            const initRes = await agent.post('/api/files/init-upload').send({
                filename: 'assembled.txt',
                size: payload.length,
                originalSize: payload.length,
                mimeType: 'text/plain',
            });
            const { fileId, uploadId, s3Key } = initRes.body;

            const uploadRes = await agent
                .put('/api/files/local-upload')
                .query({ fileId, uploadId, partNumber: 1 })
                .set('Content-Type', 'application/octet-stream')
                .send(payload);
            const etag = uploadRes.headers.etag;

            const res = await agent.post('/api/files/complete-upload').send({
                fileId,
                uploadId,
                hash: 'file-hash',
                parts: [{ partNumber: 1, etag, size: payload.length, fingerprint: 'fp1' }],
            });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Upload completed successfully');
            expect(res.body.file).toMatchObject({
                id: fileId,
                filename: 'assembled.txt',
                size: payload.length,
                mimeType: 'text/plain',
            });
            expect(res.body.user.storageUsed).toBe(payload.length);

            const file = await File.findById(fileId);
            expect(file.uploadStatus).toBe('completed');
            expect(file.uploadId).toBeUndefined();
            expect(file.hash).toBe('file-hash');
            expect(file.chunks).toHaveLength(1);
            expect(file.chunks[0].partNumber).toBe(1);

            const assembledPath = path.join(LOCAL_STORAGE_DIR, s3Key);
            expect(await fs.promises.readFile(assembledPath)).toEqual(payload);
            expect(fs.existsSync(path.join(LOCAL_STORAGE_DIR, 'chunks', fileId))).toBe(false);

            const user = await User.findOne({ email: 'complete-success@example.com' });
            expect(user.storageUsed).toBe(payload.length);
            expect(user.pendingStorage).toBe(0);
        });

        it('returns 400 when required fields are missing', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 'complete-missing@example.com',
                username: 'completemissing',
            });

            const missingParts = await agent.post('/api/files/complete-upload').send({
                fileId: 'abc',
                uploadId: 'abc',
            });
            expect(missingParts.status).toBe(400);
            expect(missingParts.body.error).toBe('Please provide fileId, uploadId, and parts array');

            const partsNotArray = await agent.post('/api/files/complete-upload').send({
                fileId: 'abc',
                uploadId: 'abc',
                parts: { partNumber: 1 },
            });
            expect(partsNotArray.status).toBe(400);
            expect(partsNotArray.body.error).toBe('Please provide fileId, uploadId, and parts array');

            const missingFileId = await agent.post('/api/files/complete-upload').send({
                uploadId: 'abc',
                parts: [{ partNumber: 1, etag: '"abc"', size: 1 }],
            });
            expect(missingFileId.status).toBe(400);
            expect(missingFileId.body.error).toBe('Please provide fileId, uploadId, and parts array');

            const missingUploadId = await agent.post('/api/files/complete-upload').send({
                fileId: 'abc',
                parts: [{ partNumber: 1, etag: '"abc"', size: 1 }],
            });
            expect(missingUploadId.status).toBe(400);
            expect(missingUploadId.body.error).toBe('Please provide fileId, uploadId, and parts array');
        });

        it('returns 400 when uploaded parts exceed declared file size', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 'complete-exceed@example.com',
                username: 'completeexceed',
            });

            const initRes = await agent.post('/api/files/init-upload').send({
                filename: 'small.txt',
                size: 10,
                originalSize: 10,
                mimeType: 'text/plain',
            });
            const { fileId, uploadId } = initRes.body;

            const res = await agent.post('/api/files/complete-upload').send({
                fileId,
                uploadId,
                parts: [{ partNumber: 1, etag: '"abc"', size: 11 }],
            });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Uploaded parts exceed declared file size');

            const file = await File.findById(fileId);
            expect(file.uploadStatus).toBe('uploading');
        });

        it('returns 404 when the upload is not an active owned upload', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 'complete-404@example.com',
                username: 'complete404',
            });

            const ownerId = '66e6e6e6e6e6e6e6e6e6e6e6';
            const file = await File.create({
                filename: 'other.txt',
                originalName: 'other.txt',
                size: 10,
                mimeType: 'text/plain',
                owner: ownerId,
                s3Bucket: 'local-bucket',
                s3Key: `users/${ownerId}/complete/other.txt`,
                uploadId: 'upload',
                uploadStatus: 'uploading',
            });

            const res = await agent.post('/api/files/complete-upload').send({
                fileId: file._id,
                uploadId: 'upload',
                parts: [{ partNumber: 1, etag: '"abc"', size: 10 }],
            });

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('File not found or unauthorized');
        });

        it('returns 500 when a local chunk is missing', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 'complete-missing-chunk@example.com',
                username: 'completemissingchunk',
            });

            const initRes = await agent.post('/api/files/init-upload').send({
                filename: 'missing-part.txt',
                size: 12,
                originalSize: 12,
                mimeType: 'text/plain',
            });
            const { fileId, uploadId } = initRes.body;

            const res = await agent.post('/api/files/complete-upload').send({
                fileId,
                uploadId,
                parts: [{ partNumber: 1, etag: '"abc"', size: 12 }],
            });

            expect(res.status).toBe(500);
            expect(res.body.error).toBe('Server error while completing upload');

            const file = await File.findById(fileId);
            expect(file.s3Key).toBeDefined();
            expect(fs.existsSync(path.join(LOCAL_STORAGE_DIR, file.s3Key))).toBe(false);
        });

        it('returns 409 when the file is no longer in completing state', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 'complete-conflict@example.com',
                username: 'completeconflict',
            });

            const payload = Buffer.from('conflict');
            const initRes = await agent.post('/api/files/init-upload').send({
                filename: 'conflict.txt',
                size: payload.length,
                originalSize: payload.length,
                mimeType: 'text/plain',
            });
            const { fileId, uploadId } = initRes.body;

            const uploadRes = await agent
                .put('/api/files/local-upload')
                .query({ fileId, uploadId, partNumber: 1 })
                .set('Content-Type', 'application/octet-stream')
                .send(payload);

            const originalFindOneAndUpdate = File.findOneAndUpdate.bind(File);
            const spy = vi.spyOn(File, 'findOneAndUpdate').mockImplementation((filter, update, options) => {
                if (filter?.uploadStatus === 'completing' && update?.$set?.uploadStatus === 'completed') {
                    return Promise.resolve(null);
                }
                return originalFindOneAndUpdate(filter, update, options);
            });

            try {
                const res = await agent.post('/api/files/complete-upload').send({
                    fileId,
                    uploadId,
                    parts: [{ partNumber: 1, etag: uploadRes.headers.etag, size: payload.length }],
                });

                expect(res.status).toBe(409);
                expect(res.body.error).toBe('Upload state conflict');

                const file = await File.findById(fileId);
                expect(file.uploadStatus).toBe('completing');
                const user = await User.findOne({ email: 'complete-conflict@example.com' });
                expect(user.storageUsed).toBe(0);
                expect(user.pendingStorage).toBe(payload.length);
            } finally {
                spy.mockRestore();
            }
        });

        it('deletes the assembled local file when completion throws', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 'complete-cleanup@example.com',
                username: 'completecleanup',
            });

            const payload = Buffer.from('cleanup-me');
            const initRes = await agent.post('/api/files/init-upload').send({
                filename: 'cleanup.txt',
                size: payload.length,
                originalSize: payload.length,
                mimeType: 'text/plain',
            });
            const { fileId, uploadId, s3Key } = initRes.body;

            const uploadRes = await agent
                .put('/api/files/local-upload')
                .query({ fileId, uploadId, partNumber: 1 })
                .set('Content-Type', 'application/octet-stream')
                .send(payload);

            const originalFindOneAndUpdate = File.findOneAndUpdate.bind(File);
            const spy = vi.spyOn(File, 'findOneAndUpdate').mockImplementation((filter, update, options) => {
                if (filter?.uploadStatus === 'completing' && update?.$set?.uploadStatus === 'completed') {
                    return Promise.reject(new Error('transaction failed'));
                }
                return originalFindOneAndUpdate(filter, update, options);
            });

            try {
                const res = await agent.post('/api/files/complete-upload').send({
                    fileId,
                    uploadId,
                    parts: [{ partNumber: 1, etag: uploadRes.headers.etag, size: payload.length }],
                });

                expect(res.status).toBe(500);
                expect(res.body.error).toBe('Server error while completing upload');
                expect(fs.existsSync(path.join(LOCAL_STORAGE_DIR, s3Key))).toBe(false);
            } finally {
                spy.mockRestore();
            }
        });
    
        it('returns 401 when not authenticated', async () => {
            const res = await request(app).post('/api/files/complete-upload').send({
                fileId: 'abc',
                uploadId: 'abc',
                parts: [{ partNumber: 1, etag: '"abc"', size: 1 }],
            });

            expect(res.status).toBe(401);
        });
    });

    describe('GET /api/files/:id/upload-status', () => {
        it('returns upload status and recorded chunks for the owner', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 'status@example.com',
                username: 'statususer',
            });

            const initRes = await agent.post('/api/files/init-upload').send({
                filename: 'status.txt',
                size: 100,
                originalSize: 100,
                mimeType: 'text/plain',
            });
            const { fileId, uploadId } = initRes.body;

            await agent
                .put('/api/files/local-upload')
                .query({ fileId, uploadId, partNumber: 1 })
                .set('Content-Type', 'application/octet-stream')
                .set('x-chunk-fingerprint', 'fp-status')
                .send(Buffer.from('partial'));

            const res = await agent.get(`/api/files/${fileId}/upload-status`);

            expect(res.status).toBe(200);
            expect(res.body.uploadStatus).toBe('uploading');
            expect(res.body.uploadId).toBe(uploadId);
            expect(res.body.uploadedChunks).toHaveLength(1);
            expect(res.body.uploadedChunks[0]).toMatchObject({
                partNumber: 1,
                fingerprint: 'fp-status',
                size: 7,
            });
        });

        it('returns 404 when the file is not owned', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 'status-other@example.com',
                username: 'statusother',
            });

            const ownerId = '66e6e6e6e6e6e6e6e6e6e6e6';
            const file = await File.create({
                filename: 'other.txt',
                originalName: 'other.txt',
                size: 10,
                mimeType: 'text/plain',
                owner: ownerId,
                s3Bucket: 'local-bucket',
                s3Key: `users/${ownerId}/status/other.txt`,
                uploadId: 'upload',
                uploadStatus: 'uploading',
            });

            const res = await agent.get(`/api/files/${file._id}/upload-status`);

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('File not found');
        });

        it('returns 400 for an invalid id', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 'status-invalid@example.com',
                username: 'statusinvalid',
            });

            const res = await agent.get('/api/files/not-an-id/upload-status');

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Invalid id');
        });

        it('returns 401 when not authenticated', async () => {
            const res = await request(app).get('/api/files/66e6e6e6e6e6e6e6e6e6e6e6/upload-status');
            expect(res.status).toBe(401);
        });
    });

    describe('GET /api/files/:id/download', () => {
        it('returns a local download URL for the owner', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 'dlurl@example.com',
                username: 'dlurluser',
            });

            const user = await User.findOne({ email: 'dlurl@example.com' });
            const file = await File.create({
                filename: 'download-me.txt',
                originalName: 'download-me.txt',
                size: 12,
                mimeType: 'text/plain',
                owner: user._id,
                s3Bucket: 'local-bucket',
                s3Key: `users/${user._id}/dl/download-me.txt`,
                uploadStatus: 'completed',
            });

            const res = await agent.get(`/api/files/${file._id}/download`);

            expect(res.status).toBe(200);
            expect(res.body.useLocalStorage).toBe(true);
            expect(res.body.filename).toBe('download-me.txt');
            expect(res.body.downloadUrl).toBe(`/api/files/local-download/${file._id}`);
            expect(res.body.expiresIn).toBe(null);
        });

        it('returns a local download URL for a shared recipient', async () => {
            const ownerAgent = request.agent(app);
            const recipientAgent = request.agent(app);

            await registerAndLogin(ownerAgent, {
                email: 'dl-share-owner@example.com',
                username: 'dlshareowner',
            });
            await registerAndLogin(recipientAgent, {
                email: 'dl-share-recipient@example.com',
                username: 'dlsharerecipient',
            });

            const owner = await User.findOne({ email: 'dl-share-owner@example.com' });
            const file = await File.create({
                filename: 'shared-dl.txt',
                originalName: 'shared-dl.txt',
                size: 8,
                mimeType: 'text/plain',
                owner: owner._id,
                s3Bucket: 'local-bucket',
                s3Key: `users/${owner._id}/dl/shared-dl.txt`,
                uploadStatus: 'completed',
            });

            const shareRes = await ownerAgent
                .post(`/api/files/${file._id}/share`)
                .send({ email: 'dl-share-recipient@example.com' });
            expect(shareRes.status).toBe(200);

            const res = await recipientAgent.get(`/api/files/${file._id}/download`);

            expect(res.status).toBe(200);
            expect(res.body.downloadUrl).toBe(`/api/files/local-download/${file._id}`);
            expect(res.body.filename).toBe('shared-dl.txt');
        });

        it('returns 404 when the file is not completed', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 'dl-notready@example.com',
                username: 'dlnotready',
            });

            const initRes = await agent.post('/api/files/init-upload').send({
                filename: 'wip-dl.txt',
                size: 10,
                originalSize: 10,
                mimeType: 'text/plain',
            });

            const res = await agent.get(`/api/files/${initRes.body.fileId}/download`);

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('File not found or not ready');
        });

        it('returns 404 when the file is not owned', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 'dl-notowned@example.com',
                username: 'dlnotowned',
            });

            const ownerId = '66e6e6e6e6e6e6e6e6e6e6e6';
            const file = await File.create({
                filename: 'notowned.txt',
                originalName: 'notowned.txt',
                size: 10,
                mimeType: 'text/plain',
                owner: ownerId,
                s3Bucket: 'local-bucket',
                s3Key: `users/${ownerId}/dl/notowned.txt`,
                uploadStatus: 'completed',
            });

            const res = await agent.get(`/api/files/${file._id}/download`);

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('File not found or not ready');
        });

        it('returns 401 when not authenticated', async () => {
            const res = await request(app).get('/api/files/66e6e6e6e6e6e6e6e6e6e6e6/download');
            expect(res.status).toBe(401);
        });
    });

    describe('GET /api/files/local-download/:id', () => {
        it('streams the file from disk for the owner', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 'localdl@example.com',
                username: 'localdluser',
            });

            const payload = Buffer.from('hello world');
            const initRes = await agent.post('/api/files/init-upload').send({
                filename: 'on-disk.txt',
                size: payload.length,
                originalSize: payload.length,
                mimeType: 'text/plain',
            });
            const { fileId, uploadId } = initRes.body;

            const uploadRes = await agent
                .put('/api/files/local-upload')
                .query({ fileId, uploadId, partNumber: 1 })
                .set('Content-Type', 'application/octet-stream')
                .send(payload);

            const completeRes = await agent.post('/api/files/complete-upload').send({
                fileId,
                uploadId,
                parts: [{ partNumber: 1, etag: uploadRes.headers.etag, size: payload.length }],
            });
            expect(completeRes.status).toBe(200);

            const res = await agent.get(`/api/files/local-download/${fileId}`);

            expect(res.status).toBe(200);
            expect(res.text).toBe('hello world');
            expect(res.headers['content-disposition']).toContain('on-disk.txt');
        });

        it('streams the file for a shared recipient', async () => {
            const ownerAgent = request.agent(app);
            const recipientAgent = request.agent(app);

            await registerAndLogin(ownerAgent, {
                email: 'localdl-owner@example.com',
                username: 'localdlowner',
            });
            await registerAndLogin(recipientAgent, {
                email: 'localdl-recipient@example.com',
                username: 'localdlrecipient',
            });

            const payload = Buffer.from('data');
            const initRes = await ownerAgent.post('/api/files/init-upload').send({
                filename: 'shared-on-disk.txt',
                size: payload.length,
                originalSize: payload.length,
                mimeType: 'text/plain',
            });
            const { fileId, uploadId } = initRes.body;

            const uploadRes = await ownerAgent
                .put('/api/files/local-upload')
                .query({ fileId, uploadId, partNumber: 1 })
                .set('Content-Type', 'application/octet-stream')
                .send(payload);

            const completeRes = await ownerAgent.post('/api/files/complete-upload').send({
                fileId,
                uploadId,
                parts: [{ partNumber: 1, etag: uploadRes.headers.etag, size: payload.length }],
            });
            expect(completeRes.status).toBe(200);

            const shareRes = await ownerAgent
                .post(`/api/files/${fileId}/share`)
                .send({ email: 'localdl-recipient@example.com' });
            expect(shareRes.status).toBe(200);

            const res = await recipientAgent.get(`/api/files/local-download/${fileId}`);

            expect(res.status).toBe(200);
            expect(res.text).toBe('data');
        });

        it('returns 404 when file content is missing on disk', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 'localdl-nodisk@example.com',
                username: 'localdlnodisk',
            });

            const user = await User.findOne({ email: 'localdl-nodisk@example.com' });
            const file = await File.create({
                filename: 'ghost.txt',
                originalName: 'ghost.txt',
                size: 1,
                mimeType: 'text/plain',
                owner: user._id,
                s3Bucket: 'local-bucket',
                s3Key: `users/${user._id}/localdl/ghost.txt`,
                uploadStatus: 'completed',
            });

            const res = await agent.get(`/api/files/local-download/${file._id}`);

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('File content not found on disk');
        });

        it('returns 404 when the file is deleted', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 'localdl-deleted@example.com',
                username: 'localdldeleted',
            });

            const user = await User.findOne({ email: 'localdl-deleted@example.com' });
            const file = await File.create({
                filename: 'deleted.txt',
                originalName: 'deleted.txt',
                size: 1,
                mimeType: 'text/plain',
                owner: user._id,
                s3Bucket: 'local-bucket',
                s3Key: `users/${user._id}/localdl/deleted.txt`,
                uploadStatus: 'completed',
            });

            await file.deleteOne();

            const res = await agent.get(`/api/files/local-download/${file._id}`);

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('File not found or not ready');
        });

        it('returns 404 when file is uploading', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 'localdl-uploading@example.com',
                username: 'localdluploading',
            });

            const initRes = await agent.post('/api/files/init-upload').send({
                filename: 'uploading.txt',
                size: 10,
                originalSize: 10,
                mimeType: 'text/plain',
            });

            const res = await agent.get(`/api/files/local-download/${initRes.body.fileId}`);

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('File not found or not ready');
        });

        it('returns 403 when the user cannot access the file', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 'localdl-denied@example.com',
                username: 'localdldenied',
            });

            const ownerId = '66e6e6e6e6e6e6e6e6e6e6e6';
            const file = await File.create({
                filename: 'secret.txt',
                originalName: 'secret.txt',
                size: 1,
                mimeType: 'text/plain',
                owner: ownerId,
                s3Bucket: 'local-bucket',
                s3Key: `users/${ownerId}/localdl/secret.txt`,
                uploadStatus: 'completed',
            });

            const res = await agent.get(`/api/files/local-download/${file._id}`);

            expect(res.status).toBe(403);
            expect(res.body.error).toBe('Access denied');
        });

        it('returns 404 when local storage is not enabled', async () => {
            process.env.USE_LOCAL_STORAGE = 'false';
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 'localdl-disabled@example.com',
                username: 'localdldisabled',
            });

            const user = await User.findOne({ email: 'localdl-disabled@example.com' });
            const file = await File.create({
                filename: 's3-only.txt',
                originalName: 's3-only.txt',
                size: 1,
                mimeType: 'text/plain',
                owner: user._id,
                s3Bucket: 'local-bucket',
                s3Key: `users/${user._id}/localdl/s3-only.txt`,
                uploadStatus: 'completed',
            });

            const res = await agent.get(`/api/files/local-download/${file._id}`);

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('Local storage is not enabled');
        });

        it('returns 401 when not authenticated', async () => {
            const res = await request(app).get('/api/files/local-download/66e6e6e6e6e6e6e6e6e6e6e6');
            expect(res.status).toBe(401);
        });
    });

    describe('DELETE /api/files/:id in-progress guard', () => {
        it('rejects delete for in-progress uploads', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, { email: 'inprog@example.com', username: 'inproguser' });

            const initRes = await agent.post('/api/files/init-upload').send({
                filename: 'wip.txt',
                size: 100,
                originalSize: 100,
                mimeType: 'text/plain',
            });

            const res = await agent.delete(`/api/files/${initRes.body.fileId}`);
            expect(res.status).toBe(400);
            expect(res.body.error).toContain('abort');
        });
    });

    describe('POST /api/files/:id/abort-upload', () => {
        it('aborts an in-progress upload and cleans up local chunks', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, { email: 'abort@example.com', username: 'abortuser' });

            const initRes = await agent.post('/api/files/init-upload').send({
                filename: 'abortme.txt',
                size: 100,
                originalSize: 100,
                mimeType: 'text/plain',
            });

            const { fileId, uploadId } = initRes.body;

            await agent
                .put(`/api/files/local-upload?fileId=${fileId}&uploadId=${uploadId}&partNumber=1`)
                .set('Content-Type', 'application/octet-stream')
                .send(Buffer.from('partial data'));

            const res = await agent.post(`/api/files/${fileId}/abort-upload`);
            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Upload aborted');

            const file = await File.findById(fileId);
            expect(file).toBeNull();

            const chunkDir = path.join(process.env.LOCAL_STORAGE_DIR || './test-uploads', 'chunks', fileId);
            expect(fs.existsSync(chunkDir)).toBe(false);
        });
    });
});
