import { S3Client } from '@aws-sdk/client-s3';

export const USE_LOCAL_STORAGE = process.env.USE_LOCAL_STORAGE === 'true';
export const LOCAL_STORAGE_DIR = process.env.LOCAL_STORAGE_DIR || './uploads';

/**
 * Initialize AWS S3 Client
 */
export const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'local-mock-key',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'local-mock-secret',
    },
});

/**
 * S3 configuration constants
 */
export const S3_CONFIG = {
    BUCKET_NAME: process.env.S3_BUCKET_NAME || 'local-bucket',
    CHUNK_SIZE: 5 * 1024 * 1024, // 5MB minimum for S3 multipart
    MAX_FILE_SIZE: 5 * 1024 * 1024 * 1024, // 5GB max
    PRESIGNED_URL_EXPIRY: 3600, // 1 hour in seconds
};


