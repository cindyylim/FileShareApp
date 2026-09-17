import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { LOCAL_STORAGE_DIR } from '../config/s3.js';

export const getChunkPath = (fileId, partNumber) =>
    path.join(LOCAL_STORAGE_DIR, 'chunks', fileId.toString(), `part-${partNumber}`);

export const saveChunk = async (fileId, partNumber, data) => {
    const chunkPath = getChunkPath(fileId, partNumber);
    await fs.promises.mkdir(path.dirname(chunkPath), { recursive: true });
    await fs.promises.writeFile(chunkPath, data);

    const md5Hash = crypto.createHash('md5').update(data).digest('hex');
    return `"${md5Hash}"`;
};

export const assembleFileFromChunks = async (fileId, s3Key, parts) => {
    const finalFilePath = path.join(LOCAL_STORAGE_DIR, s3Key);
    await fs.promises.mkdir(path.dirname(finalFilePath), { recursive: true });

    const writeStream = fs.createWriteStream(finalFilePath);
    const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const chunkDir = path.join(LOCAL_STORAGE_DIR, 'chunks', fileId.toString());

    for (const part of sortedParts) {
        const chunkPath = path.join(chunkDir, `part-${part.partNumber}`);
        if (!fs.existsSync(chunkPath)) {
            throw new Error(`Missing chunk ${part.partNumber}`);
        }
        const chunkBuffer = await fs.promises.readFile(chunkPath);
        writeStream.write(chunkBuffer);
    }

    await new Promise((resolve, reject) => {
        writeStream.end(resolve);
        writeStream.on('error', reject);
    });

    try {
        await fs.promises.rm(chunkDir, { recursive: true, force: true });
    } catch (rmErr) {
        console.warn('Local chunk folder cleanup error:', rmErr.message);
    }

    return finalFilePath;
};

export const deleteLocalFile = async (s3Key) => {
    const filePath = path.join(LOCAL_STORAGE_DIR, s3Key);
    if (!fs.existsSync(filePath)) return;

    await fs.promises.unlink(filePath);
    const folder = path.dirname(filePath);
    await fs.promises.rmdir(folder).catch(() => {});
};

/**
 * Clean up partial local upload artifacts (chunks and any assembled file).
 */
export const abortLocalUpload = async (fileId, s3Key) => {
    const chunkDir = path.join(LOCAL_STORAGE_DIR, 'chunks', fileId.toString());
    if (fs.existsSync(chunkDir)) {
        await fs.promises.rm(chunkDir, { recursive: true, force: true });
    }

    await deleteLocalFile(s3Key);
};
