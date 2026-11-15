/**
 * Error raised by mock API handlers. It carries everything needed to build the single error
 * format returned by every failing endpoint:
 *
 * ```json
 * {"status": 409, "code": "EMAIL_ALREADY_REGISTERED", "message": "...", "details": [{"field": "email", "code": "DUPLICATE"}]}
 * ```
 */
export class ApiError extends Error {
    /**
     * @param {number} status HTTP status code.
     * @param {string} code stable, machine-readable error code in SCREAMING_SNAKE_CASE.
     * @param {string} message short English description for developers.
     * @param {{field: string, code: string}[]} [details] field-level problems, when applicable.
     */
    constructor(status, code, message, details = []) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.details = details;
    }

    static validation(details, message = 'The request contains invalid data.') {
        return new ApiError(400, 'VALIDATION_ERROR', message, details);
    }

    static authenticationRequired() {
        return new ApiError(401, 'AUTHENTICATION_REQUIRED', 'A bearer access token is required.');
    }

    static invalidToken() {
        return new ApiError(401, 'INVALID_TOKEN', 'The access token is invalid, expired or has been revoked.');
    }

    static forbidden(message = 'The authenticated user lacks the required permission.') {
        return new ApiError(403, 'FORBIDDEN', message);
    }

    static notFound(code = 'NOT_FOUND', message = 'The requested resource does not exist.') {
        return new ApiError(404, code, message);
    }

    static methodNotAllowed(allowed) {
        const error = new ApiError(405, 'METHOD_NOT_ALLOWED', 'The HTTP method is not supported by this resource.');
        error.allow = allowed;
        return error;
    }

    static conflict(code, message) {
        return new ApiError(409, code, message);
    }
}

/**
 * Writes an {@link ApiError} to an Express response using the common error format.
 * @param {import('express').Response} response
 * @param {ApiError} error
 */
export function sendError(response, error) {
    if (error.status === 401) {
        response.setHeader('WWW-Authenticate', 'Bearer realm="molinex-mock-api"');
    }
    if (error.allow) {
        response.setHeader('Allow', error.allow.join(', '));
    }
    response.status(error.status).json({
        status: error.status,
        code: error.code,
        message: error.message,
        details: error.details ?? []
    });
}

/**
 * Express error-handling middleware: turns body-parser failures and unexpected exceptions into the
 * common error format, so clients never receive HTML error pages. It is registered last.
 * @type {import('express').ErrorRequestHandler}
 */
export function errorHandler(error, _request, response, next) {
    if (response.headersSent) return next(error);
    if (error instanceof ApiError) return sendError(response, error);
    if (error?.type === 'entity.parse.failed') {
        return sendError(response, new ApiError(400, 'MALFORMED_JSON', 'The request body is not valid JSON.'));
    }
    if (error?.type === 'entity.too.large') {
        return sendError(response, new ApiError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.'));
    }
    console.error('Unexpected mock API error:', error?.message ?? error);
    return sendError(response, new ApiError(500, 'INTERNAL_ERROR', 'The mock API had an internal error.'));
}
