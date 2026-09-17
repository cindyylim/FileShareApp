import express from 'express';
import fs from 'fs';
import path from 'path';
import {
    CreateMultipartUploadCommand,
    CompleteMultipartUploadCommand,
    AbortMultipartUploadCommand,
    DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { UploadPartCommand } from '@aws-sdk/client-s3';
import { s3Client, S3_CONFIG, LOCAL_STORAGE_DIR } from '../config/s3.js';
import { authenticateToken } from '../middleware/auth.js';
import { validateObjectId } from '../middleware/validateObjectId.js';
import { requireFileDownloadAccess } from '../middleware/fileAccess.js';
import { sanitizeFilename, contentDispositionFilename } from '../utils/sanitize.js';
import File from '../models/File.js';
import User from '../models/User.js';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import mongoose from 'mongoose';
import {
    incrementStorageUsed,
    reserveStorage,
    releaseStorageReservation,
    finalizeStorageReservation,
    storagePayload,
} from '../utils/storage.js';
import { saveChunk, assembleFileFromChunks, deleteLocalFile, abortLocalUpload } from '../services/localStorageService.js';

const router = express.Router();

const isLocalStorage = () => process.env.USE_LOCAL_STORAGE === 'true';
const isS3Storage = () => !isLocalStorage();

const activeUploadFilter = (fileId, ownerId, uploadId) => ({
    _id: fileId,
    owner: ownerId,
    uploadId,
    uploadStatus: 'uploading',
});

/**
 * Atomically upsert chunk metadata without read-modify-write races.
 */
const recordChunkMetadata = async (filter, chunkData) => {
    const partNumber = chunkData.partNumber;
    const chunkSet = {
        'chunks.$[elem].etag': chunkData.etag,
        'chunks.$[elem].size': chunkData.size,
        'chunks.$[elem].s3Key': chunkData.s3Key,
    };
    if (chunkData.fingerprint !== undefined) {
        chunkSet['chunks.$[elem].fingerprint'] = chunkData.fingerprint;
    }

    const updated = await File.findOneAndUpdate(
        { ...filter, 'chunks.partNumber': partNumber },
        { $set: chunkSet },
        {
            arrayFilters: [{ 'elem.partNumber': partNumber }],
            new: true,
        }
    );
    if (updated) {
        return updated;
    }

    return File.findOneAndUpdate(
        { ...filter, chunks: { $not: { $elemMatch: { partNumber } } } },
        { $push: { chunks: chunkData } },
        { new: true }
    );
};

const completedFilePayload = (file) => ({
    id: file._id,
    filename: file.filename,
    size: file.size,
    mimeType: file.mimeType,
    createdAt: file.createdAt,
});

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

        if (!filename || !size || !mimeType || !originalSize) {
            return res.status(400).json({
                error: 'Please provide filename, size, originalSize, and mimeType'
            });
        }

        if (isNaN(size) || size <= 0 || size > S3_CONFIG.MAX_FILE_SIZE) {
            return res.status(400).json({
                error: `File size must be a number between 1 byte and ${S3_CONFIG.MAX_FILE_SIZE} bytes`
            });
        }

        if (isNaN(originalSize) || originalSize <= 0 || originalSize > S3_CONFIG.MAX_FILE_SIZE) {
            return res.status(400).json({
                error: `Original size must be a number between 1 byte and ${S3_CONFIG.MAX_FILE_SIZE} bytes`
            });
        }

        if (size > originalSize) {
            return res.status(400).json({
                error: 'File size cannot be greater than original size'
            });
        }

        let safeFilename;
        try {
            safeFilename = sanitizeFilename(filename);
        } catch {
            return res.status(400).json({ error: 'Invalid filename' });
        }

        const reserved = await reserveStorage(req.user._id, size);
        if (!reserved) {
            return res.status(403).json({
                error: 'Storage quota exceeded'
            });
        }

        // Generate unique S3 key
        const fileId = new mongoose.Types.ObjectId();
        const s3Key = `users/${req.user._id}/${fileId}/${safeFilename}`;
        let uploadId;

        try {
            if (isLocalStorage()) {
                uploadId = fileId.toString();
            } else if (isS3Storage()) {
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
        } catch (error) {
            await releaseStorageReservation(req.user._id, size);
            if (isS3Storage() && uploadId) {
                try {
                    await s3Client.send(new AbortMultipartUploadCommand({
                        Bucket: S3_CONFIG.BUCKET_NAME,
                        Key: s3Key,
                        UploadId: uploadId,
                    }));
                } catch (abortError) {
                    console.error('Init upload S3 abort error:', abortError);
                }
            }
            throw error;
        }

        res.status(201).json({
            fileId,
            uploadId,
            s3Key,
            chunkSize: S3_CONFIG.CHUNK_SIZE,
            useLocalStorage: isLocalStorage(),
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

        const file = await File.findOne(activeUploadFilter(fileId, req.user._id, uploadId));

        if (!file) {
            return res.status(404).json({ error: 'File not found or unauthorized' });
        }

        if (isLocalStorage()) {
            const presignedUrl = `/api/files/local-upload?fileId=${fileId}&uploadId=${uploadId}&partNumber=${partNumber}`;
            return res.json({
                presignedUrl,
                partNumber,
                useLocalStorage: true,
            });
        }
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
    if (!isLocalStorage()) {
        return res.status(404).json({ error: 'Local storage is not enabled' });
    }

    try {
        const { fileId, partNumber, uploadId } = req.query;

        if (!fileId || !partNumber || !uploadId) {
            return res.status(400).json({ error: 'Missing fileId, partNumber, or uploadId query parameters' });
        }

        const file = await File.findOne(activeUploadFilter(fileId, req.user._id, uploadId));

        if (!file) {
            return res.status(404).json({ error: 'File not found or unauthorized' });
        }

        const etag = await saveChunk(fileId, partNumber, req.body);
        const partNum = parseInt(partNumber, 10);
        await recordChunkMetadata(activeUploadFilter(fileId, req.user._id, uploadId), {
            partNumber: partNum,
            etag,
            size: req.body.length,
            s3Key: file.s3Key,
            fingerprint: req.headers['x-chunk-fingerprint'] || undefined,
        });

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
    if (!isS3Storage()) {
        return res.status(400).json({ error: 'Chunk recording is only used for S3 uploads' });
    }

    try {
        const { fileId, uploadId, partNumber, etag, size, fingerprint } = req.body;

        if (!fileId || !uploadId || !partNumber || !etag) {
            return res.status(400).json({ error: 'Please provide fileId, uploadId, partNumber, and etag' });
        }

        const file = await File.findOne(activeUploadFilter(fileId, req.user._id, uploadId));

        if (!file) {
            return res.status(404).json({ error: 'File not found or unauthorized' });
        }

        await recordChunkMetadata(activeUploadFilter(fileId, req.user._id, uploadId), {
            partNumber,
            etag,
            size: size || 0,
            s3Key: file.s3Key,
            fingerprint,
        });

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
    let claimed = false;
    const { fileId, uploadId, parts, hash } = req.body;

    try {
        if (!fileId || !uploadId || !parts || !Array.isArray(parts)) {
            return res.status(400).json({
                error: 'Please provide fileId, uploadId, and parts array'
            });
        }

        const alreadyCompleted = await File.findOne({
            _id: fileId,
            owner: req.user._id,
            uploadStatus: 'completed',
        });
        if (alreadyCompleted) {
            const owner = await User.findById(req.user._id).select('storageUsed storageQuota');
            return res.json({
                message: 'Upload already completed',
                file: completedFilePayload(alreadyCompleted),
                user: storagePayload(owner),
            });
        }

        file = await File.findOneAndUpdate(
            activeUploadFilter(fileId, req.user._id, uploadId),
            { $set: { uploadStatus: 'completing' } },
            { new: true }
        );

        if (!file) {
            return res.status(404).json({ error: 'File not found or unauthorized' });
        }
        claimed = true;

        const totalPartSize = parts.reduce((sum, part) => sum + (part.size || 0), 0);
        if (totalPartSize > file.size) {
            await File.findOneAndUpdate(
                { _id: file._id, uploadStatus: 'completing' },
                { $set: { uploadStatus: 'uploading' } }
            );
            return res.status(400).json({ error: 'Uploaded parts exceed declared file size' });
        }

        const chunks = parts.map(part => ({
            partNumber: part.partNumber,
            etag: part.etag,
            size: part.size || 0,
            s3Key: file.s3Key,
            fingerprint: part.fingerprint,
        }));

        if (isLocalStorage()) {
            await assembleFileFromChunks(fileId, file.s3Key, parts);
        } else if (isS3Storage()) {
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
        } else {
            await File.findOneAndUpdate(
                { _id: file._id, uploadStatus: 'completing' },
                { $set: { uploadStatus: 'failed' } }
            );
            return res.status(500).json({ error: 'No storage backend configured' });
        }

        const session = await mongoose.startSession();
        session.startTransaction();

        let updatedFile;
        let updatedUser;
        try {
            updatedFile = await File.findOneAndUpdate(
                { _id: file._id, owner: req.user._id, uploadStatus: 'completing' },
                {
                    $set: {
                        uploadStatus: 'completed',
                        chunks,
                        hash,
                    },
                    $unset: { uploadId: 1 },
                },
                { session, new: true }
            );

            if (!updatedFile) {
                await session.abortTransaction();
                return res.status(409).json({ error: 'Upload state conflict' });
            }

            updatedUser = await finalizeStorageReservation(req.user._id, file.size, session);
            await session.commitTransaction();
        } catch (txError) {
            await session.abortTransaction();
            throw txError;
        } finally {
            session.endSession();
        }

        res.json({
            message: 'Upload completed successfully',
            file: completedFilePayload(updatedFile),
            user: storagePayload(updatedUser),
        });
    } catch (error) {
        console.error('Complete upload error:', error);

        if (isS3Storage() && file) {
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

        if (isLocalStorage() && file) {
            try {
                await deleteLocalFile(file.s3Key);
            } catch (deleteError) {
                console.error('Delete local file error:', deleteError);
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

        if (isLocalStorage()) {
            const downloadUrl = `/api/files/local-download/${file._id}`;
            return res.json({
                downloadUrl,
                filename: file.originalName,
                expiresIn: S3_CONFIG.PRESIGNED_URL_EXPIRY,
                useLocalStorage: true,
            });
        }

        if (!isS3Storage()) {
            return res.status(500).json({ error: 'No storage backend configured' });
        }

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
    if (!isLocalStorage()) {
        return res.status(404).json({ error: 'Local storage is not enabled' });
    }

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
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const file = await File.findOneAndUpdate(
            {
                _id: req.params.id,
                owner: req.user._id,
                isDeleted: false,
                uploadStatus: 'completed',
            },
            { $set: { isDeleted: true, sharedWith: [] } },
            { session, new: true }
        );

        if (!file) {
            await session.abortTransaction();
            const inProgress = await File.findOne({
                _id: req.params.id,
                owner: req.user._id,
                isDeleted: false,
                uploadStatus: { $in: ['uploading', 'completing'] },
            });
            if (inProgress) {
                return res.status(400).json({
                    error: 'Cannot delete in-progress upload; abort it first',
                });
            }
            return res.status(404).json({ error: 'File not found' });
        }

        await User.updateMany(
            { sharedFiles: file._id },
            { $pull: { sharedFiles: file._id } },
            { session }
        );

        const updatedUser = await incrementStorageUsed(req.user._id, -file.size, session);

        await session.commitTransaction();

        if (isLocalStorage()) {
            try {
                await deleteLocalFile(file.s3Key);
            } catch (unlinkErr) {
                console.warn('Could not delete local file:', unlinkErr.message);
            }
        } else if (isS3Storage()) {
            try {
                const deleteCommand = new DeleteObjectCommand({
                    Bucket: S3_CONFIG.BUCKET_NAME,
                    Key: file.s3Key,
                });
                await s3Client.send(deleteCommand);
            } catch (s3Err) {
                console.warn('Could not delete S3 object:', s3Err.message);
            }
        }

        res.json({
            message: 'File deleted successfully',
            user: storagePayload(updatedUser),
        });
    } catch (error) {
        await session.abortTransaction();
        console.error('Delete file error:', error);
        res.status(500).json({ error: 'Server error while deleting file' });
    } finally {
        session.endSession();
    }
});

/**
 * POST /api/files/:id/abort-upload
 * Abort an in-progress multipart upload
 */
router.post('/:id/abort-upload', authenticateToken, validateObjectId('id'), async (req, res) => {
    try {
        const file = await File.findOneAndDelete({
            _id: req.params.id,
            owner: req.user._id,
            uploadStatus: 'uploading',
        });

        if (!file) {
            const completing = await File.findOne({
                _id: req.params.id,
                owner: req.user._id,
                uploadStatus: 'completing',
            });
            if (completing) {
                return res.status(409).json({ error: 'Upload is being finalized' });
            }
            return res.status(404).json({ error: 'Active upload not found' });
        }

        await releaseStorageReservation(req.user._id, file.size);

        if (isLocalStorage()) {
            await abortLocalUpload(file._id, file.s3Key);
        } else if (isS3Storage() && file.uploadId) {
            const abortCommand = new AbortMultipartUploadCommand({
                Bucket: S3_CONFIG.BUCKET_NAME,
                Key: file.s3Key,
                UploadId: file.uploadId,
            });
            await s3Client.send(abortCommand);
        }

        res.json({ message: 'Upload aborted' });
    } catch (error) {
        console.error('Abort upload error:', error);
        res.status(500).json({ error: 'Server error while aborting upload' });
    }
});

/**
 * POST /api/files/:id/share
 * Share a file with another user
 */
router.post('/:id/share', authenticateToken, validateObjectId('id'), async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { email } = req.body;
        const fileId = req.params.id;

        if (!email) {
            await session.abortTransaction();
            return res.status(400).json({ error: 'Email is required' });
        }

        const targetUser = await User.findOne({ email: email.toLowerCase() });
        if (!targetUser) {
            await session.abortTransaction();
            return res.status(400).json({ error: 'Unable to share with this user' });
        }

        if (targetUser._id.equals(req.user._id)) {
            await session.abortTransaction();
            return res.status(400).json({ error: 'Cannot share file with yourself' });
        }

        const file = await File.findOne({
            _id: fileId,
            owner: req.user._id,
            isDeleted: false,
            uploadStatus: 'completed',
        }).session(session);

        if (!file) {
            await session.abortTransaction();
            return res.status(404).json({ error: 'File not found or unauthorized' });
        }

        const shareResult = await File.updateOne(
            {
                _id: fileId,
                isDeleted: false,
                sharedWith: { $ne: targetUser._id },
            },
            { $addToSet: { sharedWith: targetUser._id } },
            { session }
        );

        if (shareResult.modifiedCount === 0) {
            await session.abortTransaction();
            const stillExists = await File.findOne({ _id: fileId, isDeleted: false });
            if (!stillExists) {
                return res.status(404).json({ error: 'File not found or unauthorized' });
            }
            return res.status(400).json({ error: 'File already shared with this user' });
        }

        await User.updateOne(
            { _id: targetUser._id },
            { $addToSet: { sharedFiles: fileId } },
            { session }
        );

        await session.commitTransaction();

        res.json({
            message: 'File shared successfully',
            sharedWith: {
                id: targetUser._id,
                username: targetUser.username,
                email: targetUser.email,
            },
        });
    } catch (error) {
        await session.abortTransaction();
        console.error('Share file error:', error);
        res.status(500).json({ error: 'Server error while sharing file' });
    } finally {
        session.endSession();
    }
});

/**
 * DELETE /api/files/:id/unshare/:userId
 * Unshare a file with a specific user
 */
router.delete('/:id/unshare/:userId', authenticateToken, validateObjectId('id'), validateObjectId('userId'), async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { id: fileId, userId } = req.params;

        const file = await File.findOne({
            _id: fileId,
            owner: req.user._id,
            isDeleted: false,
        }).session(session);

        if (!file) {
            await session.abortTransaction();
            return res.status(404).json({ error: 'File not found or unauthorized' });
        }

        const targetUser = await User.findById(userId).session(session);
        if (!targetUser) {
            await session.abortTransaction();
            return res.status(404).json({ error: 'User not found' });
        }

        await File.updateOne(
            { _id: fileId, isDeleted: false },
            { $pull: { sharedWith: targetUser._id } },
            { session }
        );
        await User.updateOne(
            { _id: targetUser._id },
            { $pull: { sharedFiles: fileId } },
            { session }
        );

        await session.commitTransaction();

        res.json({
            message: 'File unshared successfully',
        });
    } catch (error) {
        await session.abortTransaction();
        console.error('Unshare file error:', error);
        res.status(500).json({ error: 'Server error while unsharing file' });
    } finally {
        session.endSession();
    }
});

export default router;
