import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {privateDataPathFor} from './shared/private-data-store.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultCommercialContentPath = path.join(currentDirectory, 'commercial-engagement', 'commercial-content.json');

/**
 * Immutable runtime settings required by the Molinex mock API.
 */
export class MockApiServerConfig {
    #port;
    #dbPath;
    #commercialContentPath;

    /**
     * @param {{port: number|string, dbPath: string, commercialContentPath?: string}} settings
     */
    constructor({port, dbPath, commercialContentPath}) {
        const numericPort = Number(port);
        if (!Number.isInteger(numericPort) || numericPort <= 0) {
            throw new RangeError('The server port must be a positive integer.');
        }
        if (typeof dbPath !== 'string' || dbPath.trim().length === 0) {
            throw new TypeError('The database path is required.');
        }

        this.#port = numericPort;
        this.#dbPath = dbPath;
        this.#commercialContentPath = typeof commercialContentPath === 'string' && commercialContentPath.trim().length > 0
            ? commercialContentPath
            : defaultCommercialContentPath;
    }

    get port() {
        return this.#port;
    }

    get dbPath() {
        return this.#dbPath;
    }

    /** File with the data JSON Server must never expose: credential hashes, sessions and inquiries. */
    get privateDataPath() {
        return privateDataPathFor(this.#dbPath);
    }

    /** Read-only JSON file with the public plan catalog and value proposition. */
    get commercialContentPath() {
        return this.#commercialContentPath;
    }
}
