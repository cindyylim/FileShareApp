import { describe, it, expect } from 'vitest';
import User from '../../models/User.js';

describe('User model', () => {
    it('hashes password on save', async () => {
        const user = await User.create({
            username: 'hashuser',
            email: 'hash@example.com',
            password: 'plainpassword',
        });

        expect(user.password).not.toBe('plainpassword');
        expect(user.password.length).toBeGreaterThan(20);
    });

    it('comparePassword returns true for correct password', async () => {
        const user = await User.create({
            username: 'compareuser',
            email: 'compare@example.com',
            password: 'mypassword',
        });

        const isValid = await user.comparePassword('mypassword');
        expect(isValid).toBe(true);
    });

    it('comparePassword returns false for incorrect password', async () => {
        const user = await User.create({
            username: 'wrongpass',
            email: 'wrong@example.com',
            password: 'mypassword',
        });

        const isValid = await user.comparePassword('wrongpassword');
        expect(isValid).toBe(false);
    });

    it('hasStorageSpace returns true when within quota', async () => {
        const user = await User.create({
            username: 'quotauser',
            email: 'quota@example.com',
            password: 'password123',
            storageUsed: 1000,
            storageQuota: 5000,
        });

        expect(user.hasStorageSpace(1000)).toBe(true);
        expect(user.hasStorageSpace(4000)).toBe(true);
    });

    it('hasStorageSpace returns false when exceeding quota', async () => {
        const user = await User.create({
            username: 'fulluser',
            email: 'full@example.com',
            password: 'password123',
            storageUsed: 4000,
            storageQuota: 5000,
        });

        expect(user.hasStorageSpace(2000)).toBe(false);
    });

    it('rejects duplicate email', async () => {
        await User.create({
            username: 'user1',
            email: 'dup@example.com',
            password: 'password123',
        });

        await expect(
            User.create({
                username: 'user2',
                email: 'dup@example.com',
                password: 'password123',
            })
        ).rejects.toThrow();
    });
});
