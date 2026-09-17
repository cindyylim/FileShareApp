import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { LOCAL_STORAGE_DIR } from '../../config/s3.js';
import {
    getChunkPath,
    saveChunk,
    assembleFileFromChunks,
    deleteLocalFile,
    abortLocalUpload,
} from '../../services/localStorageService.js';

const fileId = '507f1f77bcf86cd799439011';
const s3Key = `users/${fileId}/assembled.txt`;

describe('localStorageService', () => {
    describe('getChunkPath', () => {
        it('returns the path for a chunk file', () => {
            const chunkPath = getChunkPath(fileId, 2);

            expect(chunkPath).toBe(
                path.join(LOCAL_STORAGE_DIR, 'chunks', fileId, 'part-2')
            );
        });
    });

    describe('saveChunk', () => {
        it('writes chunk data to disk', async () => {
            const data = Buffer.from('chunk-one-data');

            await saveChunk(fileId, 1, data);

            const chunkPath = getChunkPath(fileId, 1);
            expect(fs.existsSync(chunkPath)).toBe(true);
            expect(await fs.promises.readFile(chunkPath)).toEqual(data);
            await fs.promises.rm(chunkPath, {recursive: true, force: true});
        });

        it('returns an MD5 etag wrapped in quotes', async () => {
            const data = Buffer.from('chunk-one-data');
            const expectedHash = crypto.createHash('md5').update(data).digest('hex');

            const etag = await saveChunk(fileId, 1, data);

            expect(etag).toBe(`"${expectedHash}"`);
            const chunkPath = getChunkPath(fileId, 1);
            await fs.promises.rm(chunkPath, {recursive: true, force: true});

        });
    });

    describe('assembleFileFromChunks', () => {
        it('assembles chunks in part order into the final file', async () => {
            await saveChunk(fileId, 2, Buffer.from('world'));
            await saveChunk(fileId, 1, Buffer.from('hello '));

            const finalPath = await assembleFileFromChunks(fileId, s3Key, [
                { partNumber: 2 },
                { partNumber: 1 },
            ]);

            expect(finalPath).toBe(path.join(LOCAL_STORAGE_DIR, s3Key));
            expect(await fs.promises.readFile(finalPath, 'utf8')).toBe('hello world');
            const chunkDir = path.join(LOCAL_STORAGE_DIR, 'chunks', fileId);
            expect(fs.existsSync(chunkDir)).toBe(false);
            await fs.promises.rm(finalPath, {recursive: true, force: true});
        });


        it('throws when a chunk file is missing', async () => {
            await expect(
                assembleFileFromChunks(fileId, s3Key, [{ partNumber: 1 }])
            ).rejects.toThrow('Missing chunk 1');
        });
    });

    describe('deleteLocalFile', () => {
        it('deletes the file and its parent directory', async () => {
            await saveChunk(fileId, 1, Buffer.from('temp'));
            await assembleFileFromChunks(fileId, s3Key, [{ partNumber: 1 }]);

            const filePath = path.join(LOCAL_STORAGE_DIR, s3Key);
            expect(fs.existsSync(filePath)).toBe(true);

            await deleteLocalFile(s3Key);

            expect(fs.existsSync(filePath)).toBe(false);
            expect(fs.existsSync(path.dirname(filePath))).toBe(false);
        });

        it('does nothing when the file does not exist', async () => {
            await expect(deleteLocalFile('users/missing/file.txt')).resolves.toBeUndefined();
        });
    });

    describe('abortLocalUpload', () => {
        it('removes chunk directory and partial assembled file', async () => {
            await saveChunk(fileId, 1, Buffer.from('partial'));
            await saveChunk(fileId, 2, Buffer.from(' data'));

            const chunkDir = path.join(LOCAL_STORAGE_DIR, 'chunks', fileId);
            expect(fs.existsSync(chunkDir)).toBe(true);

            await abortLocalUpload(fileId, s3Key);

            expect(fs.existsSync(chunkDir)).toBe(false);
            expect(fs.existsSync(path.join(LOCAL_STORAGE_DIR, s3Key))).toBe(false);
        });

        it('succeeds when no artifacts exist', async () => {
            await expect(abortLocalUpload(fileId, s3Key)).resolves.toBeUndefined();
        });
    });
});
