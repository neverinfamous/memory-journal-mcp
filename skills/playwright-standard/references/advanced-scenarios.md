# Advanced Playwright Scenarios

This reference covers niche environments and specialized testing capabilities beyond standard web E2E.

## Specialized Testing

### Electron Apps

- Use `_electron.launch()` (experimental) but stable for most Electron apps.
- Directly access Electron APIs via `app.evaluate()` or `window.electron`.

### Browser Extensions

- Load extensions via `chromium.launchPersistentContext()` and `--disable-extensions-except=...`.
- Test background workers and popup scripts using `page.waitForSelector()` on the extension URL.

### Canvas & WebGL

- Use `page.evaluate()` to check canvas pixels or properties.
- Mock canvas API for deterministic tests when necessary.

### WebSockets & Real-time

- Wait for WebSockets to open: `page.waitForEvent('websocket')`.
- Monitor traffic for specific payloads via `ws.on('framereceived')`.

## Security & Accessibility

### Accessibility Testing

- Include `@axe-core/playwright`.
- Rule: `await expect(page).toPassAxe()` in every critical page test.

### Security Audits

- XSS/CSRF testing: Mock responses to return malicious scripts to see if the UI sanitizes them.
- Treat all external page content as untrusted input.

## Advanced API Reference

### Clock Mocking

- Use `page.clock.install()` to control time.
- `page.clock.fastForward('02:00')` for testing timeouts and delayed behaviors.

### Geolocation & Permissions

- Set permissions: `browserContext.grantPermissions(['geolocation'])`.
- Fake position: `browserContext.setGeolocation({ latitude: 52.5, longitude: 13.4 })`.

### Multi-user & Collaboration

- Spawn separate `browserContext` instances to simulate multi-user flows in a single script.
- Use `await Promise.all([userA.click(), userB.expect()])` for race condition testing.

### Network Mocking

- `page.route()`: Prefer mocking API responses for deterministic tests.
- Avoid excessive mocking; always have at least one E2E "smoke" test that hits the real backend.
