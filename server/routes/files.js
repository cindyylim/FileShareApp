import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
    CreateMultipartUploadCommand,
    CompleteMultipartUploadCommand,
    AbortMultipartUploadCommand,
    DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { UploadPartCommand } from '@aws-sdk/client-s3';
import { s3Client, S3_CONFIG, USE_LOCAL_STORAGE, LOCAL_STORAGE_DIR } from '../config/s3.js';
import { authenticateToken } from '../middleware/auth.js';
import { validateObjectId } from '../middleware/validateObjectId.js';
import { requireFileDownloadAccess } from '../middleware/fileAccess.js';
import { sanitizeFilename, contentDispositionFilename } from '../utils/sanitize.js';
import File from '../models/File.js';
import User from '../models/User.js';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import mongoose from 'mongoose';
import { incrementStorageUsed, storagePayload } from '../utils/storage.js';

const router = express.Router();

const upsertChunk = (chunks, chunkData) => {
    const existing = chunks.find((c) => c.partNumber === chunkData.partNumber);
    if (existing) {
        Object.assign(existing, chunkData);
    } else {
        chunks.push(chunkData);
    }
};

/**
 * GET /api/files/shared
 * Get files shared with the current user
 */
router.get('/shared', authenticateToken, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        const files = await File.find({
            _id: { $in: req.user.sharedFiles },
            isDeleted: false,
            uploadStatus: 'completed',
        })
            .populate('owner', 'username email')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .select('-chunks'); // Don't return chunk details in list view

        const total = await File.countDocuments({
            _id: { $in: req.user.sharedFiles },
            isDeleted: false,
            uploadStatus: 'completed',
        });

        res.json({
            files,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        console.error('Get shared files error:', error);
        res.status(500).json({ error: 'Server error while fetching shared files' });
    }
});

/**
 * GET /api/files
 * List user's files with pagination
 */
router.get('/', authenticateToken, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        const files = await File.find({
            owner: req.user._id,
            isDeleted: false,
            uploadStatus: 'completed',
        })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .select('-chunks'); // Don't return chunk details in list view

        const total = await File.countDocuments({
            owner: req.user._id,
            isDeleted: false,
            uploadStatus: 'completed',
        });

        res.json({
            files,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        console.error('List files error:', error);
        res.status(500).json({ error: 'Server error while fetching files' });
    }
});

/**
 * POST /api/files/init-upload
 * Initialize multipart upload to S3
 */
router.post('/init-upload', authenticateToken, async (req, res) => {
    try {
        const { filename, size, mimeType, path = '/', isCompressed = false, originalSize } = req.body;

        if (!filename || !size || !mimeType) {
            return res.status(400).json({
                error: 'Please provide filename, size, and mimeType'
            });
        }

        if (size <= 0 || size > S3_CONFIG.MAX_FILE_SIZE) {
            return res.status(400).json({
                error: `File size must be between 1 byte and ${S3_CONFIG.MAX_FILE_SIZE} bytes`
            });
        }

        let safeFilename;
        try {
            safeFilename = sanitizeFilename(filename);
        } catch {
            return res.status(400).json({ error: 'Invalid filename' });
        }

        // Check storage quota
        const user = await User.findById(req.user._id);
        if (!user.hasStorageSpace(size)) {
            return res.status(403).json({
                error: 'Storage quota exceeded'
            });
        }

        // Generate unique S3 key
        const fileId = new mongoose.Types.ObjectId();
        const s3Key = `users/${req.user._id}/${fileId}/${safeFilename}`;
        let uploadId;

        if (USE_LOCAL_STORAGE) {
            uploadId = fileId.toString();
        } else {
            // Create multipart upload in S3
            const createCommand = new CreateMultipartUploadCommand({
                Bucket: S3_CONFIG.BUCKET_NAME,
                Key: s3Key,
                ContentType: mimeType,
                Metadata: {
                    userId: req.user._id.toString(),
                    originalName: filename,
                },
            });

            const multipartUpload = await s3Client.send(createCommand);
            uploadId = multipartUpload.UploadId;
        }

        // Create file document in MongoDB
        const file = new File({
            _id: fileId,
            filename: safeFilename,
            originalName: safeFilename,
            size,
            mimeType,
            owner: req.user._id,
            path,
            s3Bucket: S3_CONFIG.BUCKET_NAME,
            s3Key,
            uploadId,
            uploadStatus: 'uploading',
            isCompressed,
            originalSize: isCompressed ? originalSize : size,
        });

        await file.save();

        res.status(201).json({
            fileId: file._id,
            uploadId,
            s3Key,
            chunkSize: S3_CONFIG.CHUNK_SIZE,
            message: 'Upload initialized successfully',
        });
    } catch (error) {
        console.error('Init upload error:', error);
        res.status(500).json({ error: 'Server error while initializing upload' });
    }
});

/**
 * POST /api/files/presigned-url
 * Get pre-signed URL for uploading a chunk
 */
router.post('/presigned-url', authenticateToken, async (req, res) => {
    try {
        const { fileId, partNumber, uploadId } = req.body;

        if (!fileId || !partNumber || !uploadId) {
            return res.status(400).json({
                error: 'Please provide fileId, partNumber, and uploadId'
            });
        }

        // Verify file belongs to user
        const file = await File.findOne({
            _id: fileId,
            owner: req.user._id,
            uploadId,
        });

        if (!file) {
            return res.status(404).json({ error: 'File not found or unauthorized' });
        }

        if (USE_LOCAL_STORAGE) {
            const presignedUrl = `/api/files/local-upload?fileId=${fileId}&uploadId=${uploadId}&partNumber=${partNumber}`;
            return res.json({
                presignedUrl,
                partNumber,
            });
        }

        // Generate pre-signed URL for this part
        const command = new UploadPartCommand({
            Bucket: S3_CONFIG.BUCKET_NAME,
            Key: file.s3Key,
            UploadId: uploadId,
            PartNumber: partNumber,
        });

        const presignedUrl = await getSignedUrl(s3Client, command, {
            expiresIn: S3_CONFIG.PRESIGNED_URL_EXPIRY,
        });

        res.json({
            presignedUrl,
            partNumber,
        });
    } catch (error) {
        console.error('Presigned URL error:', error);
        res.status(500).json({ error: 'Server error while generating presigned URL' });
    }
});

/**
 * PUT /api/files/local-upload
 * Local chunk upload handler for USE_LOCAL_STORAGE mode
 */
router.put('/local-upload', authenticateToken, express.raw({ type: '*/*', limit: '100mb' }), async (req, res) => {
    try {
        const { fileId, partNumber, uploadId } = req.query;

        if (!fileId || !partNumber || !uploadId) {
            return res.status(400).json({ error: 'Missing fileId, partNumber, or uploadId query parameters' });
        }

        if (!mongoose.Types.ObjectId.isValid(fileId)) {
            return res.status(400).json({ error: 'Invalid fileId' });
        }

        const file = await File.findOne({
            _id: fileId,
            owner: req.user._id,
            uploadId,
        });

        if (!file) {
            return res.status(404).json({ error: 'File not found or unauthorized' });
        }

        const chunkDir = path.join(LOCAL_STORAGE_DIR, 'chunks', fileId.toString());
        await fs.promises.mkdir(chunkDir, { recursive: true });

        const chunkPath = path.join(chunkDir, `part-${partNumber}`);
        await fs.promises.writeFile(chunkPath, req.body);

        const md5Hash = crypto.createHash('md5').update(req.body).digest('hex');
        const etag = `"${md5Hash}"`;

        const partNum = parseInt(partNumber, 10);
        upsertChunk(file.chunks, {
            partNumber: partNum,
            etag,
            size: req.body.length,
            s3Key: file.s3Key,
            fingerprint: req.headers['x-chunk-fingerprint'] || undefined,
        });
        await file.save();

        res.setHeader('ETag', etag);
        res.setHeader('Access-Control-Expose-Headers', 'ETag');
        return res.status(200).send('OK');
    } catch (error) {
        console.error('Local chunk upload error:', error);
        return res.status(500).json({ error: 'Failed to save local chunk' });
    }
});

/**
 * POST /api/files/record-chunk
 * Persist chunk metadata after a successful S3 upload (enables resume)
 */
router.post('/record-chunk', authenticateToken, async (req, res) => {
    try {
        const { fileId, uploadId, partNumber, etag, size, fingerprint } = req.body;

        if (!fileId || !uploadId || !partNumber || !etag) {
            return res.status(400).json({ error: 'Please provide fileId, uploadId, partNumber, and etag' });
        }

        const file = await File.findOne({
            _id: fileId,
            owner: req.user._id,
            uploadId,
        });

        if (!file) {
            return res.status(404).json({ error: 'File not found or unauthorized' });
        }

        upsertChunk(file.chunks, {
            partNumber,
            etag,
            size: size || 0,
            s3Key: file.s3Key,
            fingerprint,
        });
        await file.save();

        res.json({ message: 'Chunk recorded' });
    } catch (error) {
        console.error('Record chunk error:', error);
        res.status(500).json({ error: 'Server error while recording chunk' });
    }
});

/**
 * POST /api/files/complete-upload
 * Complete multipart upload
 */
router.post('/complete-upload', authenticateToken, async (req, res) => {
    let file;
    try {
        const { fileId, uploadId, parts, hash } = req.body;

        if (!fileId || !uploadId || !parts || !Array.isArray(parts)) {
            return res.status(400).json({
                error: 'Please provide fileId, uploadId, and parts array'
            });
        }

        file = await File.findOne({
            _id: fileId,
            owner: req.user._id,
            uploadId,
        });

        if (!file) {
            return res.status(404).json({ error: 'File not found or unauthorized' });
        }

        const owner = await User.findById(req.user._id);
        if (!owner.hasStorageSpace(file.size)) {
            return res.status(403).json({ error: 'Storage quota exceeded' });
        }

        const totalPartSize = parts.reduce((sum, part) => sum + (part.size || 0), 0);
        if (totalPartSize > file.size) {
            return res.status(400).json({ error: 'Uploaded parts exceed declared file size' });
        }

        if (USE_LOCAL_STORAGE) {
            const finalFilePath = path.join(LOCAL_STORAGE_DIR, file.s3Key);
            const finalDirPath = path.dirname(finalFilePath);
            await fs.promises.mkdir(finalDirPath, { recursive: true });

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
        } else {
            // Complete multipart upload in S3
            const completeCommand = new CompleteMultipartUploadCommand({
                Bucket: S3_CONFIG.BUCKET_NAME,
                Key: file.s3Key,
                UploadId: uploadId,
                MultipartUpload: {
                    Parts: parts.map(part => ({
                        ETag: part.etag,
                        PartNumber: part.partNumber,
                    })),
                },
            });

            await s3Client.send(completeCommand);
        }

        // Update file document
        file.chunks = parts.map(part => ({
            partNumber: part.partNumber,
            etag: part.etag,
            size: part.size || 0,
            s3Key: file.s3Key,
            fingerprint: part.fingerprint, // Store chunk fingerprint
        }));
        file.uploadStatus = 'completed';
        file.uploadId = undefined; // Clear upload ID
        file.hash = hash;

        await file.save();

        const updatedUser = await incrementStorageUsed(req.user._id, file.size);

        res.json({
            message: 'Upload completed successfully',
            file: {
                id: file._id,
                filename: file.filename,
                size: file.size,
                mimeType: file.mimeType,
                createdAt: file.createdAt,
            },
            user: storagePayload(updatedUser),
        });
    } catch (error) {
        console.error('Complete upload error:', error);

        if (!USE_LOCAL_STORAGE && file) {
            // Try to abort the multipart upload on error
            try {
                const abortCommand = new AbortMultipartUploadCommand({
                    Bucket: S3_CONFIG.BUCKET_NAME,
                    Key: file.s3Key,
                    UploadId: uploadId,
                });
                await s3Client.send(abortCommand);
            } catch (abortError) {
                console.error('Abort upload error:', abortError);
            }
        }

        res.status(500).json({ error: 'Server error while completing upload' });
    }
});

/**
 * GET /api/files/:id/upload-status
 * Get upload status for resumable uploads
 */
router.get('/:id/upload-status', authenticateToken, validateObjectId('id'), async (req, res) => {
    try {
        const file = await File.findOne({
            _id: req.params.id,
            owner: req.user._id,
        });

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Return upload status and uploaded chunks
        res.json({
            uploadStatus: file.uploadStatus,
            uploadId: file.uploadId,
            uploadedChunks: file.chunks.map(chunk => ({
                partNumber: chunk.partNumber,
                fingerprint: chunk.fingerprint,
                etag: chunk.etag,
                size: chunk.size,
            })),
        });
    } catch (error) {
        console.error('Get upload status error:', error);
        res.status(500).json({ error: 'Server error while fetching upload status' });
    }
});

/**
 * GET /api/files/:id
 * Get file metadata
 */
router.get('/:id', authenticateToken, validateObjectId('id'), async (req, res) => {
    try {
        const file = await File.findOne({
            _id: req.params.id,
            owner: req.user._id,
            isDeleted: false,
        });

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        res.json({ file });
    } catch (error) {
        console.error('Get file error:', error);
        res.status(500).json({ error: 'Server error while fetching file' });
    }
});

/**
 * GET /api/files/:id/download
 * Get pre-signed URL for downloading file
 */
router.get('/:id/download', authenticateToken, validateObjectId('id'), async (req, res) => {
    try {
        let file = await File.findOne({
            _id: req.params.id,
            owner: req.user._id,
            isDeleted: false,
            uploadStatus: 'completed',
        });
        if (file == null) {
            file = await File.findOne({
                _id: req.params.id,
                sharedWith: req.user._id,
                isDeleted: false,
                uploadStatus: 'completed',
            });
        }

        if (!file) {
            return res.status(404).json({ error: 'File not found or not ready' });
        }

        if (USE_LOCAL_STORAGE) {
            const downloadUrl = `/api/files/local-download/${file._id}`;
            return res.json({
                downloadUrl,
                filename: file.originalName,
                expiresIn: S3_CONFIG.PRESIGNED_URL_EXPIRY,
            });
        }

        // Generate pre-signed URL for download
        const command = new GetObjectCommand({
            Bucket: S3_CONFIG.BUCKET_NAME,
            Key: file.s3Key,
            ResponseContentDisposition: contentDispositionFilename(file.originalName),
        });

        const presignedUrl = await getSignedUrl(s3Client, command, {
            expiresIn: S3_CONFIG.PRESIGNED_URL_EXPIRY,
        });

        res.json({
            downloadUrl: presignedUrl,
            filename: file.originalName,
            expiresIn: S3_CONFIG.PRESIGNED_URL_EXPIRY,
        });
    } catch (error) {
        console.error('Download file error:', error);
        res.status(500).json({ error: 'Server error while generating download URL' });
    }
});

/**
 * GET /api/files/local-download/:id
 * Direct file download endpoint for USE_LOCAL_STORAGE mode
 */
router.get('/local-download/:id', authenticateToken, validateObjectId('id'), requireFileDownloadAccess, async (req, res) => {
    try {
        const file = req.fileRecord;
        const filePath = path.join(LOCAL_STORAGE_DIR, file.s3Key);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File content not found on disk' });
        }

        return res.download(filePath, file.originalName);
    } catch (error) {
        console.error('Local download error:', error);
        return res.status(500).json({ error: 'Server error during file download' });
    }
});

/**
 * DELETE /api/files/:id
 * Delete file
 */
router.delete('/:id', authenticateToken, validateObjectId('id'), async (req, res) => {
    try {
        const file = await File.findOne({
            _id: req.params.id,
            owner: req.user._id,
            isDeleted: false,
        });

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        if (USE_LOCAL_STORAGE) {
            const filePath = path.join(LOCAL_STORAGE_DIR, file.s3Key);
            if (fs.existsSync(filePath)) {
                try {
                    await fs.promises.unlink(filePath);
                    const folder = path.dirname(filePath);
                    await fs.promises.rmdir(folder).catch(() => { });
                } catch (unlinkErr) {
                    console.warn('Could not delete local file:', unlinkErr.message);
                }
            }
        } else if (file.uploadStatus === 'completed') {
            const deleteCommand = new DeleteObjectCommand({
                Bucket: S3_CONFIG.BUCKET_NAME,
                Key: file.s3Key,
            });
            await s3Client.send(deleteCommand);
        }

        await User.updateMany(
            { sharedFiles: file._id },
            { $pull: { sharedFiles: file._id } }
        );

        file.isDeleted = true;
        file.sharedWith = [];
        await file.save();

        const updatedUser = await incrementStorageUsed(req.user._id, -file.size);

        res.json({
            message: 'File deleted successfully',
            user: storagePayload(updatedUser),
        });
    } catch (error) {
        console.error('Delete file error:', error);
        res.status(500).json({ error: 'Server error while deleting file' });
    }
});

/**
 * POST /api/files/:id/share
 * Share a file with another user
 */
router.post('/:id/share', authenticateToken, validateObjectId('id'), async (req, res) => {
    try {
        const { email } = req.body;
        const fileId = req.params.id;

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        // Find the file to share
        const file = await File.findOne({
            _id: fileId,
            owner: req.user._id,
            isDeleted: false,
        });

        if (!file) {
            return res.status(404).json({ error: 'File not found or unauthorized' });
        }

        // Find the user to share with
        const targetUser = await User.findOne({ email: email.toLowerCase() });
        if (!targetUser) {
            return res.status(400).json({ error: 'Unable to share with this user' });
        }

        // Check if file is already shared with this user
        if (file.sharedWith.includes(targetUser._id)) {
            return res.status(400).json({ error: 'File already shared with this user' });
        }

        // Check if trying to share with self
        if (targetUser._id.toString() === req.user._id.toString()) {
            return res.status(400).json({ error: 'Cannot share file with yourself' });
        }

        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            file.sharedWith.push(targetUser._id);
            await file.save({ session });
            targetUser.sharedFiles.push(file._id);
            await targetUser.save({ session });
            await session.commitTransaction();
        } catch (txError) {
            await session.abortTransaction();
            throw txError;
        } finally {
            session.endSession();
        }

        res.json({
            message: 'File shared successfully',
            sharedWith: {
                id: targetUser._id,
                username: targetUser.username,
                email: targetUser.email,
            },
        });
    } catch (error) {
        console.error('Share file error:', error);
        res.status(500).json({ error: 'Server error while sharing file' });
    }
});

/**
 * DELETE /api/files/:id/unshare/:userId
 * Unshare a file with a specific user
 */
router.delete('/:id/unshare/:userId', authenticateToken, validateObjectId('id'), validateObjectId('userId'), async (req, res) => {
    try {
        const { id: fileId, userId } = req.params;

        // Find the file
        const file = await File.findOne({
            _id: fileId,
            owner: req.user._id,
            isDeleted: false,
        });

        if (!file) {
            return res.status(404).json({ error: 'File not found or unauthorized' });
        }

        // Find the user to unshare from
        const targetUser = await User.findById(userId);
        if (!targetUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            file.sharedWith = file.sharedWith.filter(id => id.toString() !== userId);
            await file.save({ session });
            targetUser.sharedFiles = targetUser.sharedFiles.filter(id => id.toString() !== fileId);
            await targetUser.save({ session });
            await session.commitTransaction();
        } catch (txError) {
            await session.abortTransaction();
            throw txError;
        } finally {
            session.endSession();
        }

        res.json({
            message: 'File unshared successfully',
        });
    } catch (error) {
        console.error('Unshare file error:', error);
        res.status(500).json({ error: 'Server error while unsharing file' });
    }
});

export default router;
