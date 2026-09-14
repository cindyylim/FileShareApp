import './Toast.css';

function Toast({ message, type = 'info', onClose }) {
    if (!message) return null;

    return (
        <div className={`toast toast-${type}`} role="status">
            <span>{message}</span>
            {onClose && (
                <button type="button" className="toast-close" onClick={onClose} aria-label="Dismiss">
                    ×
                </button>
            )}
        </div>
    );
}

export default Toast;
