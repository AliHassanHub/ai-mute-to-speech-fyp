/**
 * Binding between application users and Python AI session-adaptation profiles.
 *
 * The AI service issues an opaque session id when a neutral baseline is
 * submitted. That id is never stored on its own: every entry records the
 * authenticated user and, when one exists, the active application session
 * (sessions.session_id).
 *
 * Storage is in-memory: the application schema has no column for an AI session id,
 * and the Python service keeps adapters in memory only, so persisted ids would
 * go stale across restarts.
 */

/** Profiles older than this are treated as expired. */
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

const sessions = new Map();

function isExpired(entry) {
    return Date.now() - entry.createdAt > SESSION_TTL_MS;
}

const setSession = (userId, { aiSessionId, appSessionId = null, baselineSamples = 0 }) => {
    const key = Number(userId);
    sessions.set(key, {
        userId: key,
        aiSessionId,
        appSessionId,
        baselineSamples,
        createdAt: Date.now(),
    });
    return sessions.get(key);
};

const getSession = (userId) => {
    const key = Number(userId);
    const entry = sessions.get(key);

    if (!entry) {
        return null;
    }

    if (isExpired(entry)) {
        sessions.delete(key);
        return null;
    }

    return entry;
};

const getSessionId = (userId) => {
    const entry = getSession(userId);
    return entry ? entry.aiSessionId : null;
};

const clearSession = (userId) => {
    return sessions.delete(Number(userId));
};

const clearAll = () => {
    sessions.clear();
};

const size = () => sessions.size;

module.exports = {
    SESSION_TTL_MS,
    setSession,
    getSession,
    getSessionId,
    clearSession,
    clearAll,
    size,
};
