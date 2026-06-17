## Layer 5: Cloudflare Edge SEO (Pages & Workers)

Since this project primarily utilizes Cloudflare, you must leverage the Edge for SEO:
* **Edge Caching for Bots:** Ensure Cloudflare caching rules explicitly accommodate `Googlebot` and other major crawlers to ensure lightning-fast time-to-first-byte (TTFB).
* **HTMLRewriter Injection:** If backend metadata is missing or dynamic, use Cloudflare's `HTMLRewriter` in a Worker or Pages Function to inject `<title>`, `<meta>`, and JSON-LD tags on the fly before it reaches the crawler.
* **Redirects & Status Codes:** Enforce strict 301 redirects at the Cloudflare Pages/Worker level (using `_redirects` or Worker logic) for any deprecated URLs. Ensure a 404 status is returned natively at the edge for missing pages.
