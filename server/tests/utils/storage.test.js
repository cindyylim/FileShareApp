import { describe, it, expect, beforeEach } from 'vitest';
import User from '../../models/User.js';
import {
    incrementStorageUsed,
    reserveStorage,
    releaseStorageReservation,
    finalizeStorageReservation,
    storagePayload,
} from '../../utils/storage.js';

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

    describe('reserveStorage', () => {
        it('reserves bytes in pendingStorage when quota allows', async () => {
            const updated = await reserveStorage(user._id, 2000);

            expect(updated.pendingStorage).toBe(2000);
            expect(updated.storageUsed).toBe(1000);
        });

        it('returns null when reservation would exceed quota', async () => {
            const updated = await reserveStorage(user._id, 4001);

            expect(updated).toBeNull();
            const reloaded = await User.findById(user._id);
            expect(reloaded.pendingStorage).toBe(0);
        });

        it('returns null when bytes is null', async () => {
            const updated = await reserveStorage(user._id, null);

            expect(updated).toBeNull();
            const reloaded = await User.findById(user._id);
            expect(reloaded.pendingStorage).toBe(0);
        });

        it('accounts for existing pending storage', async () => {
            await reserveStorage(user._id, 3000);
            const second = await reserveStorage(user._id, 1001);

            expect(second).toBeNull();
        });
    });

    describe('releaseStorageReservation', () => {
        it('releases pending storage', async () => {
            await reserveStorage(user._id, 1500);
            const updated = await releaseStorageReservation(user._id, 1500);

            expect(updated.pendingStorage).toBe(0);
        });
    });

    describe('finalizeStorageReservation', () => {
        it('moves pending bytes into storageUsed', async () => {
            await reserveStorage(user._id, 800);
            const updated = await finalizeStorageReservation(user._id, 800);

            expect(updated.storageUsed).toBe(1800);
            expect(updated.pendingStorage).toBe(0);
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
