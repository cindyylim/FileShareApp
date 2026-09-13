import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Login from './Login';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

vi.mock('../../services/api', () => ({
    authAPI: {
        login: vi.fn(),
    },
}));

vi.mock('../../services/syncService', () => ({
    initSocket: vi.fn(),
}));

vi.mock('../../stores/authStore', () => ({
    default: vi.fn((selector) => {
        const state = { setUser: vi.fn() };
        return selector(state);
    }),
}));

import { authAPI } from '../../services/api';
import { initSocket } from '../../services/syncService';
import useAuthStore from '../../stores/authStore';

const renderLogin = () =>
    render(
        <MemoryRouter>
            <Login />
        </MemoryRouter>
    );

describe('Login', () => {
    let setUser;

    beforeEach(() => {
        vi.clearAllMocks();
        setUser = vi.fn();
        useAuthStore.mockImplementation((selector) =>
            selector({ setUser })
        );
    });

    it('renders login form fields', () => {
        renderLogin();

        expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    });

    it('submits credentials and navigates on success', async () => {
        const user = userEvent.setup();
        const mockUser = { username: 'testuser', email: 'test@example.com' };
        authAPI.login.mockResolvedValue({ data: { user: mockUser } });

        renderLogin();

        await user.type(screen.getByLabelText(/email/i), 'test@example.com');
        await user.type(screen.getByLabelText(/password/i), 'password123');
        await user.click(screen.getByRole('button', { name: /sign in/i }));

        await waitFor(() => {
            expect(authAPI.login).toHaveBeenCalledWith({
                email: 'test@example.com',
                password: 'password123',
            });
        });

        expect(setUser).toHaveBeenCalledWith(mockUser);
        expect(initSocket).toHaveBeenCalled();
        expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    });

    it('displays error message on login failure', async () => {
        const user = userEvent.setup();
        authAPI.login.mockRejectedValue({
            response: { data: { error: 'Invalid email or password' } },
        });

        renderLogin();

        await user.type(screen.getByLabelText(/email/i), 'wrong@example.com');
        await user.type(screen.getByLabelText(/password/i), 'wrongpass');
        await user.click(screen.getByRole('button', { name: /sign in/i }));

        await waitFor(() => {
            expect(screen.getByText('Invalid email or password')).toBeInTheDocument();
        });

        expect(mockNavigate).not.toHaveBeenCalled();
    });
});
