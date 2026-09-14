import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ProtectedRoute from './ProtectedRoute';

vi.mock('../stores/authStore', () => ({
    default: vi.fn(),
}));

import useAuthStore from '../stores/authStore';

describe('ProtectedRoute', () => {
    it('renders children when authenticated', () => {
        useAuthStore.mockImplementation((selector) =>
            selector({ isAuthenticated: () => true })
        );

        render(
            <MemoryRouter>
                <ProtectedRoute>
                    <div>Protected content</div>
                </ProtectedRoute>
            </MemoryRouter>
        );

        expect(screen.getByText('Protected content')).toBeInTheDocument();
    });

    it('redirects to login when not authenticated', () => {
        useAuthStore.mockImplementation((selector) =>
            selector({ isAuthenticated: () => false })
        );

        render(
            <MemoryRouter initialEntries={['/dashboard']}>
                <ProtectedRoute>
                    <div>Protected content</div>
                </ProtectedRoute>
            </MemoryRouter>
        );

        expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    });
});
