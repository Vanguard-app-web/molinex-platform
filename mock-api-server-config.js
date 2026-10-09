/**
 * Immutable runtime settings required by the Molinex mock API.
 */
export class MockApiServerConfig {
    #port;
    #dbPath;

    /**
     * @param {{port: number|string, dbPath: string}} settings
     */
    constructor({port, dbPath}) {
        const numericPort = Number(port);
        if (!Number.isInteger(numericPort) || numericPort <= 0) {
            throw new RangeError('The server port must be a positive integer.');
        }
        if (typeof dbPath !== 'string' || dbPath.trim().length === 0) {
            throw new TypeError('The database path is required.');
        }

        this.#port = numericPort;
        this.#dbPath = dbPath;
    }

    get port() {
        return this.#port;
    }

    get dbPath() {
        return this.#dbPath;
    }
}
