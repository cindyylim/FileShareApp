import axios from 'axios';

/**
 * Base API URL - uses Vite proxy in development
 */
const API_BASE_URL = '/api';

/**
 * Create axios instance with default config
 */
const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
    withCredentials: true, // Send cookies with requests
});

/**
 * Request interceptor
 */
api.interceptors.request.use(
    (config) => {
        // No need to add Authorization header manually with cookies
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

/**
 * Response interceptor for error handling
 */
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            if (window.location.pathname !== '/login' && window.location.pathname !== '/register') {
                window.location.href = '/login';
            }
        }
        return Promise.reject(error);
    }
);

/**
 * Authentication APIs
 */
export const authAPI = {
    register: (data) => api.post('/auth/register', data),
    login: (data) => api.post('/auth/login', data),
    logout: () => api.post('/auth/logout'),
    getMe: () => api.get('/auth/me'),
};

/**
 * File APIs
 */
export const fileAPI = {
    list: (params) => api.get('/files', { params }),
    get: (id) => api.get(`/files/${id}`),
    initUpload: (data) => api.post('/files/init-upload', data),
    getPresignedUrl: (data) => api.post('/files/presigned-url', data),
    completeUpload: (data) => api.post('/files/complete-upload', data),
    recordChunk: (data) => api.post('/files/record-chunk', data),
    abortUpload: (fileId) => api.post(`/files/${fileId}/abort-upload`),
    download: (id) => api.get(`/files/${id}/download`),
    delete: (id) => api.delete(`/files/${id}`),
    getUploadStatus: (id) => api.get(`/files/${id}/upload-status`),
    share: (id, email) => api.post(`/files/${id}/share`, { email }),
    getShared: (params) => api.get('/files/shared', { params }),
    unshare: (id, userId) => api.delete(`/files/${id}/unshare/${userId}`),
};

const uploadChunkLocally = async (uploadUrl, chunk, fingerprint) => {
    const headers = { 'Content-Type': 'application/octet-stream' };
    if (fingerprint) {
        headers['X-Chunk-Fingerprint'] = fingerprint;
    }

    const response = await fetch(uploadUrl, {
        method: 'PUT',
        body: chunk,
        credentials: 'include',
        headers,
    });

    if (!response.ok) {
        throw new Error('Failed to upload chunk locally');
    }

    return response.headers.get('ETag');
};

const uploadChunkToS3 = async (presignedUrl, chunk) => {
    const response = await fetch(presignedUrl, {
        method: 'PUT',
        body: chunk,
        credentials: 'omit',
        headers: { 'Content-Type': 'application/octet-stream' },
    });

    if (!response.ok) {
        throw new Error('Failed to upload chunk to S3');
    }

    return response.headers.get('ETag');
};

/**
 * Upload a file chunk to local storage or S3 based on server config.
 */
export const uploadChunk = async (uploadUrl, chunk, fingerprint, useLocalStorage) => {
    if (useLocalStorage) {
        return uploadChunkLocally(uploadUrl, chunk, fingerprint);
    }
    return uploadChunkToS3(uploadUrl, chunk);
};

export default api;
