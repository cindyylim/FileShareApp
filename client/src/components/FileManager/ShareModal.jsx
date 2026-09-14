import React, { useState, useEffect, useRef } from 'react';
import './ShareModal.css';

function ShareModal({ isOpen, onClose, onShare, fileName }) {
    const modalRef = useRef(null);
    const [email, setEmail] = useState('');
    const [sharing, setSharing] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (!email.trim()) {
            setError('Please enter an email address');
            return;
        }

        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            setError('Please enter a valid email address');
            return;
        }

        setSharing(true);
        setError('');

        try {
            await onShare(email.trim());
            setEmail('');
            onClose();
        } catch (error) {
            setError(error.message || 'Failed to share file');
        } finally {
            setSharing(false);
        }
    };

    const handleClose = () => {
        if (!sharing) {
            setEmail('');
            setError('');
            onClose();
        }
    };

    useEffect(() => {
        if (!isOpen) return;
        const onKeyDown = (e) => {
            if (e.key === 'Escape' && !sharing) {
                setEmail('');
                setError('');
                onClose();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        modalRef.current?.focus();
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [isOpen, sharing, onClose]);

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={handleClose} role="presentation">
            <div
                className="modal-content"
                role="dialog"
                aria-modal="true"
                aria-labelledby="share-modal-title"
                ref={modalRef}
                tabIndex={-1}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="modal-header">
                    <h3 id="share-modal-title">Share File</h3>
                    <button 
                        className="modal-close" 
                        onClick={handleClose}
                        disabled={sharing}
                    >
                        ×
                    </button>
                </div>
                
                <div className="modal-body">
                    <p>Share "{fileName}" with another user by entering their email address.</p>
                    
                    <form onSubmit={handleSubmit} className="share-form">
                        <div className="form-group">
                            <label htmlFor="email">Email Address</label>
                            <input
                                type="email"
                                id="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="Enter email address"
                                disabled={sharing}
                                autoFocus
                            />
                        </div>
                        
                        {error && <div className="error-message">{error}</div>}
                        
                        <div className="modal-actions">
                            <button 
                                type="button" 
                                className="btn btn-secondary" 
                                onClick={handleClose}
                                disabled={sharing}
                            >
                                Cancel
                            </button>
                            <button 
                                type="submit" 
                                className="btn btn-primary"
                                disabled={sharing}
                            >
                                {sharing ? 'Sharing...' : 'Share File'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}

export default ShareModal;