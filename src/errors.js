export class SomewhereError extends Error {
    constructor(init) {
        super(init.message);
        this.name = 'SomewhereError';
        this.code = init.code;
        this.statusCode = init.statusCode;
        this.retry = init.retry;
        this.retryAfterMs = init.retryAfterMs;
        this.body = init.body;
    }
}
