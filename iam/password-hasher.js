import {randomBytes, scrypt, scryptSync, timingSafeEqual} from 'node:crypto';

const KEY_LENGTH = 64;
const COST = {N: 16384, r: 8, p: 1};

const derive = (password, salt, parameters) => new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, {N: parameters.N, r: parameters.r, p: parameters.p}, (error, key) =>
        (error ? reject(error) : resolve(key)));
});

/**
 * Hashes a password with scrypt (Node built-in). Only the returned record is ever persisted.
 * @param {string} password
 * @returns {Promise<{algorithm: string, salt: string, hash: string, N: number, r: number, p: number}>}
 */
export async function hashPassword(password) {
    const salt = randomBytes(16);
    const key = await derive(password, salt, COST);
    return {algorithm: 'scrypt', salt: salt.toString('base64'), hash: key.toString('base64'), ...COST};
}

/**
 * Synchronous variant used only while seeding the demonstration accounts at start-up.
 * @param {string} password
 */
export function hashPasswordSync(password) {
    const salt = randomBytes(16);
    const key = scryptSync(password, salt, KEY_LENGTH, COST);
    return {algorithm: 'scrypt', salt: salt.toString('base64'), hash: key.toString('base64'), ...COST};
}

/**
 * Checks a password against a stored record in constant time.
 * @param {string} password
 * @param {{salt: string, hash: string, N: number, r: number, p: number}} record
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, record) {
    const expected = Buffer.from(record.hash, 'base64');
    const actual = await derive(password, Buffer.from(record.salt, 'base64'), record);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}
