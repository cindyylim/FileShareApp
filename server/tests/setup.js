import { beforeAll, afterAll, afterEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import path from 'path';

let mongoServer;

beforeAll(async () => {
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.USE_LOCAL_STORAGE = 'true';
    process.env.LOCAL_STORAGE_DIR = './test-uploads';
    process.env.NODE_ENV = 'test';
    process.env.MONGOMS_DOWNLOAD_DIR = path.join(process.cwd(), '.mongodb-binaries');

    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
        await mongoServer.stop();
    }
});

afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
        await collections[key].deleteMany();
    }
});
