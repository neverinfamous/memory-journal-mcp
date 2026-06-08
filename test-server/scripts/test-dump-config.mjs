import { execSync } from 'child_process';
import assert from 'assert';

console.log('Testing Config Validation and --dump-config...');

// Test 1: Validation Error Aggregation
try {
    console.log('  Testing validation error aggregation (multiple invalid inputs)...');
    execSync('node dist/cli.js --port abc --archive-older-than-days -5', {
        env: {
            ...process.env,
            ALLOWED_IO_ROOTS: 'invalid-json'
        },
        stdio: 'pipe'
    });
    assert.fail('Should have failed validation');
} catch (error) {
    const stderr = error.stderr?.toString() || '';
    // Check for aggregated errors header
    assert(stderr.includes('Startup Configuration Errors:'), `Missing error aggregation header in stderr: ${stderr}`);
    
    // Check for specific validation errors
    assert(stderr.includes('numeric configuration for port'), `Missing PORT error in stderr: ${stderr}`);
    assert(stderr.includes('Invalid ALLOWED_IO_ROOTS'), `Missing ALLOWED_IO_ROOTS error in stderr: ${stderr}`);
    assert(stderr.includes('archiveOlderThanDays must be at least 0'), `Missing ARCHIVE_OLDER_THAN_DAYS error in stderr: ${stderr}`);
}

// Test 2: Config Dumping and Secret Redaction
try {
    console.log('  Testing --dump-config with redacted secrets...');
    const stdout = execSync('node dist/cli.js --dump-config', {
        env: {
            ...process.env,
            MCP_AUTH_TOKEN: 'super-secret-token',
            OAUTH_ISSUER: 'https://secret.issuer',
            OAUTH_JWKS_URI: 'https://secret.jwks'
        },
        stdio: 'pipe'
    }).toString();

    const config = JSON.parse(stdout);
    
    // Assert redacted values
    assert.strictEqual(config.authToken, '[REDACTED]', 'authToken should be redacted');
    assert.strictEqual(config.oauthIssuer, '[REDACTED]', 'oauthIssuer should be redacted');
    assert.strictEqual(config.oauthJwksUri, '[REDACTED]', 'oauthJwksUri should be redacted');
    
    // Assert non-sensitive values are preserved
    assert.strictEqual(config.transport, 'stdio');
} catch (error) {
    console.error('Failed --dump-config output check:');
    console.error(error.stderr ? error.stderr.toString() : error.message);
    process.exit(1);
}

console.log('✅ Config validation and --dump-config tests passed.');
