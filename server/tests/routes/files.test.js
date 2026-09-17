import { describe, it, expect, beforeEach } from 'vitest';
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
            expect(res.body.error).toContain('S3');
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
