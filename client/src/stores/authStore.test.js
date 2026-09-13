import { describe, it, expect, vi, beforeEach } from 'vitest';
import useAuthStore from './authStore';

vi.mock('../services/api', () => ({
    authAPI: {
        getMe: vi.fn(),
    },
}));

import { authAPI } from '../services/api';

describe('authStore', () => {
    beforeEach(() => {
        useAuthStore.setState({ user: null, loading: true });
        vi.clearAllMocks();
    });

    it('setUser updates user state', () => {
        const user = { username: 'test', email: 'test@example.com' };
        useAuthStore.getState().setUser(user);
        expect(useAuthStore.getState().user).toEqual(user);
    });

    it('logout clears user state', () => {
        useAuthStore.setState({ user: { username: 'test' } });
        useAuthStore.getState().logout();
        expect(useAuthStore.getState().user).toBeNull();
    });

    it('isAuthenticated returns true when user exists', () => {
        useAuthStore.setState({ user: { username: 'test' } });
        expect(useAuthStore.getState().isAuthenticated()).toBe(true);
    });

    it('isAuthenticated returns false when user is null', () => {
        useAuthStore.setState({ user: null });
        expect(useAuthStore.getState().isAuthenticated()).toBe(false);
    });

    it('checkAuth sets user on successful API call', async () => {
        const user = { username: 'authuser', email: 'auth@example.com' };
        authAPI.getMe.mockResolvedValue({ data: { user } });

        await useAuthStore.getState().checkAuth();

        expect(useAuthStore.getState().user).toEqual(user);
        expect(useAuthStore.getState().loading).toBe(false);
    });

    it('checkAuth clears user on API failure', async () => {
        useAuthStore.setState({ user: { username: 'stale' } });
        authAPI.getMe.mockRejectedValue(new Error('Unauthorized'));

        await useAuthStore.getState().checkAuth();

        expect(useAuthStore.getState().user).toBeNull();
        expect(useAuthStore.getState().loading).toBe(false);
    });
});
