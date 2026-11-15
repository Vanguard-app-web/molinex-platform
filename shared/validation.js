/**
 * Field validation helpers shared by the IAM and Commercial Engagement handlers. They collect
 * problems as `{field, code}` pairs so one 400 response can describe every invalid field.
 */

/** Pragmatic address check: one "@", no whitespace and a dotted domain. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
/** Characters a human-written phone number may contain. */
const PHONE_CHARACTERS = /^\+?[0-9\s().-]+$/;

export const MAX_EMAIL_LENGTH = 254;

export const isNonBlankString = value => typeof value === 'string' && value.trim().length > 0;

export const isValidEmail = value =>
    typeof value === 'string' && value.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(value.trim());

/**
 * A phone number is valid when it only uses digits, spaces and the usual punctuation and holds
 * between 7 and 15 digits (the E.164 maximum). Callers decide whether the phone is optional.
 */
export const isValidPhone = value => {
    if (typeof value !== 'string' || !PHONE_CHARACTERS.test(value.trim())) return false;
    const digits = value.replace(/\D/g, '').length;
    return digits >= 7 && digits <= 15;
};

export const normalizeEmail = value => value.trim().toLowerCase();

/** Collects field problems and raises them together. */
export class FieldProblems {
    #problems = [];

    add(field, code) {
        this.#problems.push({field, code});
        return this;
    }

    /** Requires a non-blank string, optionally capped by `maxLength`. */
    requireText(value, field, maxLength) {
        if (!isNonBlankString(value)) return this.add(field, 'REQUIRED');
        if (maxLength && value.trim().length > maxLength) return this.add(field, 'TOO_LONG');
        return this;
    }

    /** Accepts a missing/blank value or a string within `maxLength`. */
    optionalText(value, field, maxLength) {
        if (value === undefined || value === null || value === '') return this;
        if (typeof value !== 'string') return this.add(field, 'INVALID_TYPE');
        if (maxLength && value.trim().length > maxLength) return this.add(field, 'TOO_LONG');
        return this;
    }

    requireEmail(value, field = 'email') {
        if (!isNonBlankString(value)) return this.add(field, 'REQUIRED');
        if (!isValidEmail(value)) return this.add(field, 'INVALID_FORMAT');
        return this;
    }

    optionalPhone(value, field) {
        if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return this;
        if (!isValidPhone(value)) return this.add(field, 'INVALID_FORMAT');
        return this;
    }

    get hasProblems() {
        return this.#problems.length > 0;
    }

    get list() {
        return [...this.#problems];
    }
}

/** @returns {object} the body when it is a JSON object, otherwise an empty object. */
export const bodyOf = request =>
    (request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body : {});
