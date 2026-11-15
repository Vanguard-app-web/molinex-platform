import fs from 'node:fs';
import path from 'node:path';

/**
 * Derives the location of the private data file from the JSON Server database path:
 * `<directory>/<name>.json` becomes `<directory>/<name>.private.json`.
 * @param {string} dbPath
 * @returns {string}
 */
export function privateDataPathFor(dbPath) {
    const directory = path.dirname(dbPath);
    const name = path.basename(dbPath, path.extname(dbPath));
    return path.join(directory, `${name}.private.json`);
}

/**
 * JSON file that holds data JSON Server must never expose through its generic CRUD routes:
 * credential hashes, access-token hashes and commercial inquiries. It is read once at start-up and
 * rewritten atomically after every change.
 */
export class PrivateDataStore {
    #filePath;
    #data;

    /**
     * @param {string} filePath
     * @param {() => object} createInitialData builds the content of a file that does not exist yet.
     */
    constructor(filePath, createInitialData) {
        this.#filePath = filePath;
        if (fs.existsSync(filePath)) {
            this.#data = this.#read();
        } else {
            this.#data = createInitialData();
            this.commit();
        }
    }

    get filePath() {
        return this.#filePath;
    }

    /** Live document; change it and call {@link commit} to persist the change. */
    get data() {
        return this.#data;
    }

    /** Persists the document with a write-then-rename so a crash never leaves a half-written file. */
    commit() {
        fs.mkdirSync(path.dirname(this.#filePath), {recursive: true});
        const temporaryPath = `${this.#filePath}.${process.pid}.tmp`;
        fs.writeFileSync(temporaryPath, JSON.stringify(this.#data, null, 2), 'utf8');
        fs.renameSync(temporaryPath, this.#filePath);
    }

    #read() {
        try {
            return JSON.parse(fs.readFileSync(this.#filePath, 'utf8'));
        } catch (error) {
            throw new Error(`The private data file ${this.#filePath} is not valid JSON: ${error.message}`);
        }
    }
}
