const formatMessage = (level, message, meta) => {
    const entry = {
        level,
        message,
        timestamp: new Date().toISOString(),
        ...(meta && { meta }),
    };
    return JSON.stringify(entry);
};

export const logger = {
    info: (message, meta) => console.log(formatMessage('info', message, meta)),
    warn: (message, meta) => console.warn(formatMessage('warn', message, meta)),
    error: (message, meta) => console.error(formatMessage('error', message, meta)),
};
