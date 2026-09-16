import { describe, it, expect, beforeEach } from 'vitest';
import User from '../../models/User.js';
import { incrementStorageUsed, storagePayload } from '../../utils/storage.js';

describe('storage utilities', () => {
    let user;

    beforeEach(async () => {
        user = await User.create({
            username: 'storageuser',
            email: 'storage@example.com',
            password: 'password123',
            storageUsed: 1000,
            storageQuota: 5000,
        });
    });

    describe('incrementStorageUsed', () => {
        it('increments storageUsed and returns updated fields', async () => {
            const updated = await incrementStorageUsed(user._id, 500);

            expect(updated.storageUsed).toBe(1500);
            expect(updated.storageQuota).toBe(5000);
        });

        it('decrements storageUsed for negative bytes', async () => {
            const updated = await incrementStorageUsed(user._id, -400);

            expect(updated.storageUsed).toBe(600);
        });

        it('persists the change in the database', async () => {
            await incrementStorageUsed(user._id, 250);

            const reloaded = await User.findById(user._id);
            expect(reloaded.storageUsed).toBe(1250);
        });

        it('returns only storageUsed and storageQuota fields', async () => {
            const updated = await incrementStorageUsed(user._id, 100);

            expect(updated.username).toBeUndefined();
            expect(updated.email).toBeUndefined();
            expect(updated.password).toBeUndefined();
        });
    });

    describe('storagePayload', () => {
        it('returns storage fields from a user document', () => {
            expect(storagePayload(user)).toEqual({
                storageUsed: 1000,
                storageQuota: 5000,
            });
        });

        it('defaults to zero when user is null', () => {
            expect(storagePayload(null)).toEqual({
                storageUsed: 0,
                storageQuota: 0,
            });
        });

        it('defaults to zero when user is undefined', () => {
            expect(storagePayload(undefined)).toEqual({
                storageUsed: 0,
                storageQuota: 0,
            });
        });

        it('defaults missing fields to zero', () => {
            expect(storagePayload({})).toEqual({
                storageUsed: 0,
                storageQuota: 0,
            });
        });
    });
});
