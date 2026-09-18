import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import {
    CreateMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import File from '../../models/File.js';
import User from '../../models/User.js';
import { S3_CONFIG } from '../../config/s3.js';

const { s3Send, getSignedUrlMock } = vi.hoisted(() => ({
    s3Send: vi.fn(),
    getSignedUrlMock: vi.fn(),
}));

vi.mock('../../config/s3.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        s3Client: { send: s3Send },
    };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
    getSignedUrl: getSignedUrlMock,
}));

const { createApp } = await import('../../app.js');
const app = createApp();

const commandName = (command) => command?.constructor?.name;

const defaultS3Send = async (command) => {
    if (command instanceof CreateMultipartUploadCommand || commandName(command) === 'CreateMultipartUploadCommand') {
        return { UploadId: 'mock-s3-upload-id' };
    }
    return {};
};

const registerAndLogin = async (agent, user = {}) => {
    const defaults = {
        username: 's3fileuser',
        email: 's3files@example.com',
        password: 'password123',
    };
    const data = { ...defaults, ...user };
    await agent.post('/api/auth/register').send(data);
    return data;
};

const initUpload = async (agent, overrides = {}) => {
    const res = await agent.post('/api/files/init-upload').send({
        filename: 's3.txt',
        size: 100,
        originalSize: 100,
        mimeType: 'text/plain',
        ...overrides,
    });
    return res;
};

describe('files routes (S3)', () => {
    beforeEach(() => {
        process.env.USE_LOCAL_STORAGE = 'false';
        s3Send.mockReset();
        s3Send.mockImplementation(defaultS3Send);
        getSignedUrlMock.mockReset();
        getSignedUrlMock.mockResolvedValue('https://s3.example.com/presigned');
    });

    afterEach(() => {
        process.env.USE_LOCAL_STORAGE = 'true';
        vi.restoreAllMocks();
    });

    describe('POST /api/files/init-upload', () => {
        it('creates an S3 multipart upload', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 's3-init@example.com',
                username: 's3init',
            });

            const res = await initUpload(agent);

            expect(res.status).toBe(201);
            expect(res.body.uploadId).toBe('mock-s3-upload-id');
            expect(res.body.useLocalStorage).toBe(false);
            expect(res.body.chunkSize).toBe(S3_CONFIG.CHUNK_SIZE);
            expect(res.body.s3Key).toBeDefined();
            expect(s3Send).toHaveBeenCalled();
            expect(commandName(s3Send.mock.calls[0][0])).toBe('CreateMultipartUploadCommand');

            const file = await File.findById(res.body.fileId);
            expect(file.s3Bucket).toBe(S3_CONFIG.BUCKET_NAME);
            expect(file.filename).toBe('s3.txt');
            expect(file.originalName).toBe('s3.txt');
            expect(file.s3Key).toBeDefined();
            expect(file.uploadId).toBe('mock-s3-upload-id');
            expect(file.uploadStatus).toBe('uploading');
            expect(file.isCompressed).toBe(false);
            expect(file.originalSize).toBe(100);
            expect(file.size).toBe(100);
            expect(file.mimeType).toBe('text/plain');
            const owner = await User.findOne({ email: 's3-init@example.com' });
            expect(file.owner.toString()).toBe(owner._id.toString());
            expect(file.path).toBeDefined();
        });

        it('returns 500 and skips abort when S3 create fails before uploadId exists', async () => {
            s3Send.mockRejectedValueOnce(new Error('s3 create failed'));
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 's3-init-fail@example.com',
                username: 's3initfail',
            });

            const res = await initUpload(agent);

            expect(res.status).toBe(500);
            expect(res.body.error).toBe('Server error while initializing upload');
            expect(s3Send.mock.calls.every((call) => commandName(call[0]) !== 'AbortMultipartUploadCommand')).toBe(true);

            const user = await User.findOne({ email: 's3-init-fail@example.com' });
            expect(user.pendingStorage).toBe(0);
        });

        it('aborts the S3 multipart upload when saving the file fails', async () => {
            const saveSpy = vi.spyOn(File.prototype, 'save').mockRejectedValueOnce(new Error('db fail'));
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 's3-init-abort@example.com',
                username: 's3initabort',
            });

            const res = await initUpload(agent);

            expect(res.status).toBe(500);
            expect(s3Send.mock.calls.some((call) => commandName(call[0]) === 'AbortMultipartUploadCommand')).toBe(true);
            saveSpy.mockRestore();
        });
    });

    describe('POST /api/files/presigned-url', () => {
        it('returns an S3 presigned upload URL', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 's3-presign@example.com',
                username: 's3presign',
            });

            const initRes = await initUpload(agent);
            const { fileId, uploadId } = initRes.body;

            const res = await agent.post('/api/files/presigned-url').send({
                fileId,
                uploadId,
                partNumber: 1,
            });

            expect(res.status).toBe(200);
            expect(res.body.presignedUrl).toBe('https://s3.example.com/presigned');
            expect(res.body.partNumber).toBe(1);
            expect(res.body.useLocalStorage).toBeUndefined();
            expect(getSignedUrlMock).toHaveBeenCalled();
            expect(commandName(getSignedUrlMock.mock.calls[0][1])).toBe('UploadPartCommand');
        });
    });

    describe('PUT /api/files/local-upload', () => {
        it('returns 404 when using S3 storage', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 's3-localupload@example.com',
                username: 's3localupload',
            });

            const res = await agent
                .put('/api/files/local-upload')
                .query({ fileId: 'abc', uploadId: 'abc', partNumber: 1 })
                .set('Content-Type', 'application/octet-stream')
                .send(Buffer.from('data'));

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('Local storage is not enabled');
        });
    });

    describe('POST /api/files/record-chunk', () => {
        it('records chunk metadata for an S3 upload', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 's3-record@example.com',
                username: 's3record',
            });

            const initRes = await initUpload(agent);
            const { fileId, uploadId } = initRes.body;

            const res = await agent.post('/api/files/record-chunk').send({
                fileId,
                uploadId,
                partNumber: 1,
                etag: '"etag-1"',
                size: 50,
                fingerprint: 'fp-1',
            });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Chunk recorded');

            const file = await File.findById(fileId);
            expect(file.chunks).toHaveLength(1);
            expect(file.chunks[0]).toMatchObject({
                partNumber: 1,
                etag: '"etag-1"',
                size: 50,
                fingerprint: 'fp-1',
            });
        });

        it('returns 400 when required fields are missing', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 's3-record-missing@example.com',
                username: 's3recordmissing',
            });

            const missingEtag = await agent.post('/api/files/record-chunk').send({
                fileId: 'abc',
                uploadId: 'abc',
                partNumber: 1,
            });
            expect(missingEtag.status).toBe(400);
            expect(missingEtag.body.error).toBe('Please provide fileId, uploadId, partNumber, and etag');

            const missingPartNumber = await agent.post('/api/files/record-chunk').send({
                fileId: 'abc',
                uploadId: 'abc',
                etag: '"etag-1"',
            });
            expect(missingPartNumber.status).toBe(400);
            expect(missingPartNumber.body.error).toBe('Please provide fileId, uploadId, partNumber, and etag');

            const missingUploadId = await agent.post('/api/files/record-chunk').send({
                fileId: 'abc',
                partNumber: 1,
                etag: '"etag-1"',
            });
            expect(missingUploadId.status).toBe(400);
            expect(missingUploadId.body.error).toBe('Please provide fileId, uploadId, partNumber, and etag');

            const missingFileId = await agent.post('/api/files/record-chunk').send({
                uploadId: 'abc',
                partNumber: 1,
                etag: '"etag-1"',
            });
            expect(missingFileId.status).toBe(400);
            expect(missingFileId.body.error).toBe('Please provide fileId, uploadId, partNumber, and etag');
        });

        it('returns 404 when the upload is not an active owned upload', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 's3-record-404@example.com',
                username: 's3record404',
            });

            const user = await User.findOne({ email: 's3-record-404@example.com' });
            const file = await File.create({
                filename: 'done.txt',
                originalName: 'done.txt',
                size: 50,
                mimeType: 'text/plain',
                owner: user._id,
                s3Bucket: S3_CONFIG.BUCKET_NAME,
                s3Key: `users/${user._id}/s3/done.txt`,
                uploadId: 'stale-upload',
                uploadStatus: 'completed',
            });

            const res = await agent.post('/api/files/record-chunk').send({
                fileId: file._id,
                uploadId: 'stale-upload',
                partNumber: 1,
                etag: '"etag-1"',
            });

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('File not found or unauthorized');
        });
        
        it('returns 404 when the upload belongs to a different user', async () => {
            const ownerAgent = request.agent(app);
            const otherAgent = request.agent(app);

            await registerAndLogin(ownerAgent, {
                email: 's3-record-owner@example.com',
                username: 's3recordowner',
            });
            await registerAndLogin(otherAgent, {
                email: 's3-record-other@example.com',
                username: 's3recordother',
            });

            const initRes = await initUpload(ownerAgent);
            const { fileId, uploadId } = initRes.body;

            const res = await otherAgent.post('/api/files/record-chunk').send({
                fileId,
                uploadId,
                partNumber: 1,
                etag: '"etag-1"',
            });

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('File not found or unauthorized');
        });

        it('updates metadata when the same part number is recorded again', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 's3-record-update@example.com',
                username: 's3recordupdate',
            });

            const initRes = await initUpload(agent);
            const { fileId, uploadId } = initRes.body;

            await agent.post('/api/files/record-chunk').send({
                fileId,
                uploadId,
                partNumber: 1,
                etag: '"etag-old"',
                size: 10,
                fingerprint: 'fp-old',
            });

            const res = await agent.post('/api/files/record-chunk').send({
                fileId,
                uploadId,
                partNumber: 1,
                etag: '"etag-new"',
                size: 40,
                fingerprint: 'fp-new',
            });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Chunk recorded');

            const file = await File.findById(fileId);
            expect(file.chunks).toHaveLength(1);
            expect(file.chunks[0]).toMatchObject({
                partNumber: 1,
                etag: '"etag-new"',
                size: 40,
                fingerprint: 'fp-new',
            });
        });
    });

    describe('POST /api/files/complete-upload', () => {
        it('completes an S3 multipart upload', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 's3-complete@example.com',
                username: 's3complete',
            });

            const initRes = await initUpload(agent);
            const { fileId, uploadId } = initRes.body;

            const res = await agent.post('/api/files/complete-upload').send({
                fileId,
                uploadId,
                hash: 's3-hash',
                parts: [{ partNumber: 1, etag: '"etag-1"', size: 100 }],
            });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Upload completed successfully');
            expect(res.body.file.id).toBe(fileId);
            expect(res.body.user.storageUsed).toBe(100);
            expect(s3Send.mock.calls.some((call) => commandName(call[0]) === 'CompleteMultipartUploadCommand')).toBe(true);

            const file = await File.findById(fileId);
            expect(file.uploadStatus).toBe('completed');
            expect(file.uploadId).toBeUndefined();
        });

        it('aborts the S3 upload when complete fails', async () => {
            s3Send.mockImplementation(async (command) => {
                if (commandName(command) === 'CreateMultipartUploadCommand') {
                    return { UploadId: 'mock-s3-upload-id' };
                }
                if (commandName(command) === 'CompleteMultipartUploadCommand') {
                    throw new Error('complete failed');
                }
                return {};
            });

            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 's3-complete-fail@example.com',
                username: 's3completefail',
            });

            const initRes = await initUpload(agent);
            const { fileId, uploadId } = initRes.body;

            const res = await agent.post('/api/files/complete-upload').send({
                fileId,
                uploadId,
                parts: [{ partNumber: 1, etag: '"etag-1"', size: 100 }],
            });

            expect(res.status).toBe(500);
            expect(res.body.error).toBe('Server error while completing upload');
            expect(s3Send.mock.calls.some((call) => commandName(call[0]) === 'AbortMultipartUploadCommand')).toBe(true);
        });
    });

    describe('GET /api/files/:id/upload-status', () => {
        it('returns upload status for an S3 upload in progress', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 's3-status@example.com',
                username: 's3status',
            });

            const initRes = await initUpload(agent);
            const { fileId, uploadId } = initRes.body;

            await agent.post('/api/files/record-chunk').send({
                fileId,
                uploadId,
                partNumber: 1,
                etag: '"etag-1"',
                size: 40,
                fingerprint: 'fp-s3',
            });

            const res = await agent.get(`/api/files/${fileId}/upload-status`);

            expect(res.status).toBe(200);
            expect(res.body.uploadStatus).toBe('uploading');
            expect(res.body.uploadId).toBe('mock-s3-upload-id');
            expect(res.body.uploadedChunks[0]).toMatchObject({
                partNumber: 1,
                fingerprint: 'fp-s3',
            });
        });
    });

    describe('GET /api/files/:id/download', () => {
        it('returns an S3 presigned download URL', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 's3-download@example.com',
                username: 's3download',
            });

            const user = await User.findOne({ email: 's3-download@example.com' });
            const file = await File.create({
                filename: 'dl.txt',
                originalName: 'dl.txt',
                size: 10,
                mimeType: 'text/plain',
                owner: user._id,
                s3Bucket: S3_CONFIG.BUCKET_NAME,
                s3Key: `users/${user._id}/s3/dl.txt`,
                uploadStatus: 'completed',
            });

            const res = await agent.get(`/api/files/${file._id}/download`);

            expect(res.status).toBe(200);
            expect(res.body.downloadUrl).toBe('https://s3.example.com/presigned');
            expect(res.body.filename).toBe('dl.txt');
            expect(res.body.expiresIn).toBe(S3_CONFIG.PRESIGNED_URL_EXPIRY);
            expect(res.body.useLocalStorage).toBeUndefined();
            expect(commandName(getSignedUrlMock.mock.calls[0][1])).toBe('GetObjectCommand');
        });
    });

    describe('GET /api/files/local-download/:id', () => {
        it('returns 404 when using S3 storage', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 's3-localdl@example.com',
                username: 's3localdl',
            });

            const user = await User.findOne({ email: 's3-localdl@example.com' });
            const file = await File.create({
                filename: 'no-local.txt',
                originalName: 'no-local.txt',
                size: 10,
                mimeType: 'text/plain',
                owner: user._id,
                s3Bucket: S3_CONFIG.BUCKET_NAME,
                s3Key: `users/${user._id}/s3/no-local.txt`,
                uploadStatus: 'completed',
            });

            const res = await agent.get(`/api/files/local-download/${file._id}`);

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('Local storage is not enabled');
        });
    });

    describe('DELETE /api/files/:id', () => {
        it('deletes the S3 object for a completed file', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 's3-delete@example.com',
                username: 's3delete',
            });

            const user = await User.findOne({ email: 's3-delete@example.com' });
            const file = await File.create({
                filename: 'gone.txt',
                originalName: 'gone.txt',
                size: 25,
                mimeType: 'text/plain',
                owner: user._id,
                s3Bucket: S3_CONFIG.BUCKET_NAME,
                s3Key: `users/${user._id}/s3/gone.txt`,
                uploadStatus: 'completed',
            });

            const res = await agent.delete(`/api/files/${file._id}`);

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('File deleted successfully');
            expect(s3Send.mock.calls.some((call) => commandName(call[0]) === 'DeleteObjectCommand')).toBe(true);

            const deleted = await File.findById(file._id);
            expect(deleted.isDeleted).toBe(true);
        });
    });

    describe('POST /api/files/:id/abort-upload', () => {
        it('aborts an in-progress S3 multipart upload', async () => {
            const agent = request.agent(app);
            await registerAndLogin(agent, {
                email: 's3-abort@example.com',
                username: 's3abort',
            });

            const initRes = await initUpload(agent);
            const { fileId } = initRes.body;

            const res = await agent.post(`/api/files/${fileId}/abort-upload`);

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Upload aborted');
            expect(s3Send.mock.calls.some((call) => commandName(call[0]) === 'AbortMultipartUploadCommand')).toBe(true);
            expect(await File.findById(fileId)).toBeNull();
            const user = await User.findOne({ email: 's3-abort@example.com' });
            expect(user.pendingStorage).toBe(0);
        });
    });
});
