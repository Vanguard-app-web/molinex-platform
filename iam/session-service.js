import {createHash, randomBytes} from 'node:crypto';

/** Prefix that makes demonstration tokens recognizable; they are NOT JWTs. */
export const TOKEN_PREFIX = 'mlx-demo.';
/** Lifetime of a demonstration session. */
export const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;

const hashToken = token => createHash('sha256').update(token).digest('hex');

/**
 * Issues and verifies opaque demonstration access tokens. Only the SHA-256 hash of a token is
 * stored (in the private data file), so a leaked data file does not leak usable tokens. This is a
 * local simulation: it provides no production-grade security guarantees.
 */
export class SessionService {
    #store;

    /** @param {import('../shared/private-data-store.js').PrivateDataStore} store */
    constructor(store) {
        this.#store = store;
        this.#prune();
    }

    get #sessions() {
        return this.#store.data.iam.sessions;
    }

    /**
     * @param {string} userId
     * @returns {{token: string, expiresAt: string}}
     */
    issue(userId) {
        this.#prune();
        const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
        const issuedAt = Date.now();
        const expiresAt = new Date(issuedAt + SESSION_LIFETIME_MS).toISOString();
        this.#sessions.push({tokenHash: hashToken(token), userId, issuedAt: new Date(issuedAt).toISOString(), expiresAt});
        this.#store.commit();
        return {token, expiresAt};
    }

    /**
     * @param {string} token
     * @returns {{userId: string, expiresAt: string}|null} null when unknown, revoked or expired.
     */
    resolve(token) {
        if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX)) return null;
        const tokenHash = hashToken(token);
        const session = this.#sessions.find(candidate => candidate.tokenHash === tokenHash);
        if (!session || Date.parse(session.expiresAt) <= Date.now()) return null;
        return {userId: session.userId, expiresAt: session.expiresAt};
    }

    /** Invalidates one token (sign-out). Unknown tokens are ignored. */
    revoke(token) {
        const tokenHash = hashToken(token);
        const remaining = this.#sessions.filter(candidate => candidate.tokenHash !== tokenHash);
        if (remaining.length !== this.#sessions.length) {
            this.#store.data.iam.sessions = remaining;
            this.#store.commit();
        }
    }

    #prune() {
        const now = Date.now();
        const active = this.#sessions.filter(session => Date.parse(session.expiresAt) > now);
        if (active.length !== this.#sessions.length) {
            this.#store.data.iam.sessions = active;
            this.#store.commit();
        }
    }
}
