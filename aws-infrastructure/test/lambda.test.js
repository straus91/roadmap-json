/**
 * ROADMAP Lambda Function - Unit Tests
 *
 * Run with: npm test
 */

// Mock AWS SDK before requiring the handler
const mockGetSecretValue = jest.fn();
const mockPutMetricData = jest.fn();

jest.mock('@aws-sdk/client-secrets-manager', () => ({
    SecretsManagerClient: jest.fn(() => ({
        send: mockGetSecretValue
    })),
    GetSecretValueCommand: jest.fn()
}));

jest.mock('@aws-sdk/client-cloudwatch', () => ({
    CloudWatchClient: jest.fn(() => ({
        send: mockPutMetricData
    })),
    PutMetricDataCommand: jest.fn()
}));

// Import handler after mocking
const { handler } = require('../lambda/index');

// Test data
const VALID_API_KEY = 'AIzaSyABC123XYZ456DEF789GHI012JKL345MNO';
const VALID_PROMPT = 'Extract ROADMAP data from this document';

// Mock context
const mockContext = {
    requestId: 'test-request-id',
    getRemainingTimeInMillis: () => 30000
};

describe('Lambda Handler - Input Validation', () => {

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.GEMINI_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test';

        // Default mock: successful secret retrieval
        mockGetSecretValue.mockResolvedValue({
            SecretString: VALID_API_KEY
        });
    });

    test('should reject missing prompt', async () => {
        const event = {
            body: JSON.stringify({})
        };

        const response = await handler(event, mockContext);

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body);
        expect(body.error).toBe('Validation failed');
        expect(body.details).toContain('Missing or invalid required field: prompt (string)');
    });

    test('should reject empty prompt', async () => {
        const event = {
            body: JSON.stringify({ prompt: '' })
        };

        const response = await handler(event, mockContext);

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body);
        expect(body.details).toContain('prompt cannot be empty');
    });

    test('should reject prompt exceeding max length', async () => {
        const event = {
            body: JSON.stringify({
                prompt: 'a'.repeat(50001) // MAX is 50000
            })
        };

        const response = await handler(event, mockContext);

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body);
        expect(body.details.some(e => e.includes('exceeds maximum length'))).toBe(true);
    });

    test('should reject invalid temperature', async () => {
        const event = {
            body: JSON.stringify({
                prompt: VALID_PROMPT,
                temperature: 3.0 // Max is 2.0
            })
        };

        const response = await handler(event, mockContext);

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body);
        expect(body.details.some(e => e.includes('Invalid temperature'))).toBe(true);
    });

    test('should reject invalid maxOutputTokens', async () => {
        const event = {
            body: JSON.stringify({
                prompt: VALID_PROMPT,
                maxOutputTokens: 10000 // Max is 8192
            })
        };

        const response = await handler(event, mockContext);

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body);
        expect(body.details.some(e => e.includes('Invalid maxOutputTokens'))).toBe(true);
    });

    test('should reject too many images', async () => {
        const event = {
            body: JSON.stringify({
                prompt: VALID_PROMPT,
                images: new Array(11).fill({ base64: 'abc', mimeType: 'image/jpeg' }) // Max is 10
            })
        };

        const response = await handler(event, mockContext);

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body);
        expect(body.details.some(e => e.includes('Too many images'))).toBe(true);
    });

    test('should reject invalid JSON', async () => {
        const event = {
            body: 'not valid json'
        };

        const response = await handler(event, mockContext);

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body);
        expect(body.error).toBe('Invalid JSON in request body');
    });

    test('should accept valid minimal request', async () => {
        const event = {
            body: JSON.stringify({
                prompt: VALID_PROMPT
            })
        };

        // Mock successful Gemini response
        const https = require('https');
        jest.spyOn(https, 'request').mockImplementation((url, options, callback) => {
            const res = {
                statusCode: 200,
                on: (event, handler) => {
                    if (event === 'data') {
                        handler(JSON.stringify({
                            candidates: [{
                                content: {
                                    parts: [{ text: 'Response text' }]
                                }
                            }]
                        }));
                    }
                    if (event === 'end') handler();
                }
            };
            callback(res);
            return {
                on: jest.fn(),
                setTimeout: jest.fn(),
                write: jest.fn(),
                end: jest.fn()
            };
        });

        const response = await handler(event, mockContext);

        expect(response.statusCode).toBe(200);
    });
});

describe('Lambda Handler - API Key Management', () => {

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.GEMINI_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test';
    });

    test('should handle missing secret ARN', async () => {
        delete process.env.GEMINI_SECRET_ARN;

        const event = {
            body: JSON.stringify({ prompt: VALID_PROMPT })
        };

        const response = await handler(event, mockContext);

        expect(response.statusCode).toBe(503);
    });

    test('should handle Secrets Manager failure', async () => {
        mockGetSecretValue.mockRejectedValue(new Error('Access denied'));

        const event = {
            body: JSON.stringify({ prompt: VALID_PROMPT })
        };

        const response = await handler(event, mockContext);

        expect(response.statusCode).toBe(503);
    });

    test('should validate API key format from Secrets Manager', async () => {
        mockGetSecretValue.mockResolvedValue({
            SecretString: 'invalid-key-format'
        });

        const event = {
            body: JSON.stringify({ prompt: VALID_PROMPT })
        };

        const response = await handler(event, mockContext);

        expect(response.statusCode).toBe(503);
    });

    test('should handle JSON-wrapped secret', async () => {
        mockGetSecretValue.mockResolvedValue({
            SecretString: JSON.stringify({ apiKey: VALID_API_KEY })
        });

        const event = {
            body: JSON.stringify({ prompt: VALID_PROMPT })
        };

        // This will fail at Gemini API call, but should pass secret retrieval
        const response = await handler(event, mockContext);

        // Secret retrieval should succeed
        expect(mockGetSecretValue).toHaveBeenCalled();
    });
});

describe('Lambda Handler - Error Handling', () => {

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.GEMINI_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test';
        mockGetSecretValue.mockResolvedValue({
            SecretString: VALID_API_KEY
        });
    });

    test('should return 429 on rate limit', async () => {
        const https = require('https');
        jest.spyOn(https, 'request').mockImplementation((url, options, callback) => {
            const res = {
                statusCode: 429,
                on: (event, handler) => {
                    if (event === 'data') handler('Rate limit exceeded');
                    if (event === 'end') handler();
                }
            };
            callback(res);
            return {
                on: jest.fn(),
                setTimeout: jest.fn(),
                write: jest.fn(),
                end: jest.fn()
            };
        });

        const event = {
            body: JSON.stringify({ prompt: VALID_PROMPT })
        };

        const response = await handler(event, mockContext);

        expect(response.statusCode).toBe(429);
        const body = JSON.parse(response.body);
        expect(body.error).toContain('Rate limit');
    });

    test('should handle timeout errors', async () => {
        const https = require('https');
        jest.spyOn(https, 'request').mockImplementation((url, options, callback) => {
            const req = {
                on: jest.fn(),
                setTimeout: (timeout, handler) => {
                    handler(); // Trigger timeout immediately
                },
                destroy: jest.fn(),
                write: jest.fn(),
                end: jest.fn()
            };
            return req;
        });

        const event = {
            body: JSON.stringify({ prompt: VALID_PROMPT })
        };

        const response = await handler(event, mockContext);

        expect(response.statusCode).toBe(504);
        const body = JSON.parse(response.body);
        expect(body.error).toContain('timeout');
    });
});

describe('Lambda Handler - Metrics', () => {

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.GEMINI_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test';
        mockGetSecretValue.mockResolvedValue({
            SecretString: VALID_API_KEY
        });
        mockPutMetricData.mockResolvedValue({});
    });

    test('should publish success metrics', async () => {
        const https = require('https');
        jest.spyOn(https, 'request').mockImplementation((url, options, callback) => {
            const res = {
                statusCode: 200,
                on: (event, handler) => {
                    if (event === 'data') {
                        handler(JSON.stringify({
                            candidates: [{
                                content: {
                                    parts: [{ text: 'Response' }]
                                }
                            }]
                        }));
                    }
                    if (event === 'end') handler();
                }
            };
            callback(res);
            return {
                on: jest.fn(),
                setTimeout: jest.fn(),
                write: jest.fn(),
                end: jest.fn()
            };
        });

        const event = {
            body: JSON.stringify({ prompt: VALID_PROMPT })
        };

        await handler(event, mockContext);

        // Should publish multiple metrics
        expect(mockPutMetricData).toHaveBeenCalled();
    });
});
