import {spawn} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Asks the operating system for a free TCP port. */
function findFreePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const {port} = probe.address();
            probe.close(() => resolve(port));
        });
    });
}

/**
 * Creates a temporary data directory with a copy of the committed operational database, so tests
 * never touch the project's own `db.json` or private data file.
 */
export function createTemporaryDataDirectory() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molinex-mock-test-'));
    fs.copyFileSync(path.join(projectRoot, 'db.json'), path.join(directory, 'db.json'));
    return {
        directory,
        dbPath: path.join(directory, 'db.json'),
        privateDataPath: path.join(directory, 'db.private.json')
    };
}

/**
 * Starts `server.js` as a child process on a free port and waits until it answers.
 * @param {{dbPath: string, commercialContentPath?: string}} options
 */
export async function startMockServer({dbPath, commercialContentPath}) {
    const port = await findFreePort();
    const environment = {...process.env, PORT: String(port), JSON_SERVER_DB_PATH: dbPath};
    if (commercialContentPath) environment.COMMERCIAL_CONTENT_PATH = commercialContentPath;
    else delete environment.COMMERCIAL_CONTENT_PATH;

    const child = spawn(process.execPath, ['server.js'], {cwd: projectRoot, env: environment, stdio: ['ignore', 'pipe', 'pipe']});
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });

    const baseUrl = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (child.exitCode !== null) throw new Error(`The mock server exited early:\n${output}`);
        try {
            const response = await fetch(`${baseUrl}/api/v1/health`);
            if (response.ok) break;
        } catch {
            // Not listening yet.
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    return {
        baseUrl,
        /** Sends a request and returns {status, headers, body}; the body is parsed JSON when possible. */
        async request(method, resource, {token, body, rawBody, headers = {}} = {}) {
            const response = await fetch(`${baseUrl}${resource}`, {
                method,
                headers: {
                    ...(body !== undefined || rawBody !== undefined ? {'Content-Type': 'application/json'} : {}),
                    ...(token ? {Authorization: `Bearer ${token}`} : {}),
                    ...headers
                },
                body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body))
            });
            const text = await response.text();
            let parsed = text;
            try { parsed = text ? JSON.parse(text) : null; } catch { /* keep the raw text */ }
            return {status: response.status, headers: response.headers, body: parsed, text};
        },
        async stop() {
            if (child.exitCode !== null) return;
            await new Promise(resolve => {
                child.once('exit', resolve);
                child.kill();
            });
        }
    };
}
