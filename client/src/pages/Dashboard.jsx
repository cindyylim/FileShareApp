import React, { useState, useEffect, useCallback } from 'react';
import useAuthStore from '../stores/authStore';
import FileList from '../components/FileManager/FileList';
import FileUpload from '../components/FileManager/FileUpload';
import SyncIndicator from '../components/FileManager/SyncIndicator';
import Toast from '../components/Toast';
import { fileAPI, authAPI } from '../services/api';
import { initSocket, disconnectSocket, onFileChange, offFileChange } from '../services/syncService';
import { formatFileSize } from '../utils/fileUtils';
import { useNavigate } from 'react-router-dom';
import './Dashboard.css';

const PAGE_SIZE = 20;

function Dashboard() {
    const navigate = useNavigate();
    const [files, setFiles] = useState([]);
    const [sharedFiles, setSharedFiles] = useState([]);
    const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
    const [sharedPagination, setSharedPagination] = useState({ page: 1, pages: 1, total: 0 });
    const [loading, setLoading] = useState(true);
    const [loadingShared, setLoadingShared] = useState(false);
    const [activeTab, setActiveTab] = useState('my-files');
    const { user, logout, setUser } = useAuthStore();
    const [lastSync, setLastSync] = useState(null);
    const [toast, setToast] = useState({ message: '', type: 'info' });

    const showToast = (message, type = 'info') => setToast({ message, type });

    const loadFiles = async (page = 1) => {
        try {
            const response = await fileAPI.list({ page, limit: PAGE_SIZE });
            setFiles(response.data.files);
            setPagination(response.data.pagination);
        } catch (error) {
            console.error('Error loading files:', error);
            showToast('Failed to load files', 'error');
        } finally {
            setLoading(false);
        }
    };

    const loadSharedFiles = async (page = 1) => {
        setLoadingShared(true);
        try {
            const response = await fileAPI.getShared({ page, limit: PAGE_SIZE });
            setSharedFiles(response.data.files);
            setSharedPagination(response.data.pagination);
        } catch (error) {
            console.error('Error loading shared files:', error);
            showToast('Failed to load shared files', 'error');
        } finally {
            setLoadingShared(false);
        }
    };

    useEffect(() => {
        if (activeTab === 'my-files') {
            loadFiles(pagination.page);
        } else {
            loadSharedFiles(sharedPagination.page);
        }
    }, [activeTab]);

    const updateFileList = useCallback((setter, file, targetId) => {
        setter((prev) => {
            if (file.isDeleted) {
                return prev.filter((f) => f._id?.toString() !== targetId);
            }
            const exists = prev.some((f) => f._id?.toString() === targetId);
            if (exists) {
                return prev.map((f) => (f._id?.toString() === targetId ? { ...f, ...file } : f));
            }
            if (file.uploadStatus === 'completed') {
                return [file, ...prev];
            }
            return prev;
        });
    }, []);

    useEffect(() => {
        initSocket();

        const handleFileChange = (data) => {
            setLastSync(new Date());
            const file = data.file;
            if (!file) return;

            const targetId = file._id?.toString();
            if (!targetId) return;

            if (data.type === 'delete' || file.isDeleted) {
                setFiles((prev) => prev.filter((f) => f._id?.toString() !== targetId));
                setSharedFiles((prev) => prev.filter((f) => f._id?.toString() !== targetId));
                return;
            }

            updateFileList(setFiles, file, targetId);

            const isSharedWithMe = file.sharedWith?.some(
                (id) => id?.toString() === user?._id?.toString() || id === user?._id
            );
            if (isSharedWithMe) {
                updateFileList(setSharedFiles, file, targetId);
            }
        };

        onFileChange(handleFileChange);
        return () => offFileChange(handleFileChange);
    }, [user, updateFileList]);

    const handleLogout = async () => {
        try {
            await authAPI.logout();
            disconnectSocket();
            logout();
            navigate('/login');
        } catch (error) {
            disconnectSocket();
            logout();
            navigate('/login');
        }
    };

    const handleFileDeleted = (fileId) => {
        setFiles((prev) => prev.filter((f) => f._id !== fileId));
        setSharedFiles((prev) => prev.filter((f) => f._id !== fileId));
    };

    const handleUploadComplete = (updatedUser) => {
        if (updatedUser) {
            setUser({ ...user, ...updatedUser });
        }
        loadFiles(1);
        showToast('File uploaded successfully', 'success');
    };

    const handleStorageUpdate = (updatedUser) => {
        if (updatedUser && user) {
            setUser({ ...user, ...updatedUser });
        }
    };

    const currentFiles = activeTab === 'my-files' ? files : sharedFiles;
    const currentLoading = activeTab === 'my-files' ? loading : loadingShared;
    const currentPagination = activeTab === 'my-files' ? pagination : sharedPagination;

    const loadMore = () => {
        const nextPage = currentPagination.page + 1;
        if (nextPage > currentPagination.pages) return;
        if (activeTab === 'my-files') {
            loadFiles(nextPage);
        } else {
            loadSharedFiles(nextPage);
        }
    };

    return (
        <div className="dashboard">
            <header className="dashboard-header glass-card">
                <div className="header-left">
                    <h1 className="logo">☁️ File Sync App</h1>
                    <SyncIndicator lastSync={lastSync} />
                </div>

                <div className="header-right">
                    {user && (
                        <div className="user-info">
                            <div className="user-avatar">{user.username[0].toUpperCase()}</div>
                            <div className="user-details">
                                <div className="user-name">{user.username}</div>
                                <div className="user-storage">
                                    {formatFileSize(user.storageUsed || 0)} / {formatFileSize(user.storageQuota || 5 * 1024 * 1024 * 1024)}
                                </div>
                            </div>
                        </div>
                    )}
                    <button className="btn btn-secondary" onClick={handleLogout}>
                        Logout
                    </button>
                </div>
            </header>

            <main className="dashboard-content">
                <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: '', type: 'info' })} />

                <div className="content-header">
                    <div className="tabs">
                        <button
                            className={`tab-button ${activeTab === 'my-files' ? 'active' : ''}`}
                            onClick={() => setActiveTab('my-files')}
                        >
                            My Files
                        </button>
                        <button
                            className={`tab-button ${activeTab === 'shared-files' ? 'active' : ''}`}
                            onClick={() => setActiveTab('shared-files')}
                        >
                            Shared with Me
                        </button>
                    </div>
                    <div>
                        <h2>{activeTab === 'my-files' ? 'My Files' : 'Shared with Me'}</h2>
                        <p className="content-subtitle">
                            {currentPagination.total} {currentPagination.total === 1 ? 'file' : 'files'}
                        </p>
                    </div>
                </div>

                {activeTab === 'my-files' && (
                    <FileUpload onUploadComplete={handleUploadComplete} onError={(msg) => showToast(msg, 'error')} />
                )}

                {currentLoading ? (
                    <div className="loading-container">
                        <div className="spinner" />
                        <p>Loading {activeTab === 'my-files' ? 'files' : 'shared files'}...</p>
                    </div>
                ) : (
                    <>
                        <FileList
                            files={currentFiles}
                            onFileDeleted={handleFileDeleted}
                            onStorageUpdate={handleStorageUpdate}
                            onNotify={showToast}
                            showOwner={activeTab === 'shared-files'}
                            isOwnerView={activeTab === 'my-files'}
                        />
                        {currentPagination.page < currentPagination.pages && (
                            <div className="load-more-container">
                                <button className="btn btn-secondary" onClick={loadMore}>
                                    Load more
                                </button>
                            </div>
                        )}
                    </>
                )}
            </main>
        </div>
    );
}

export default Dashboard;
