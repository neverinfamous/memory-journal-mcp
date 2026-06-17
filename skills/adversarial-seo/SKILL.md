---
name: adversarial-seo
description: Adversarial SEO enforcement skill. A proactive guide for modifying the codebase, web UI, or generated content to enforce Technical SEO, Semantic Markup, and E-E-A-T standards autonomously.
---

# Adversarial SEO Enforcement & Healing Guardrails

The primary philosophy of this skill is: **When you (the agent) encounter missing metadata, poor semantic structure, or non-compliant SEO practices, DO NOT ignore it or just suggest fixes.**

You must act adversarially against bad SEO practices. You must proactively modify the architecture, components, or content generation logic to ensure future outputs are fully SEO-compliant by default. 

This document details the critical SEO layers you must enforce as an integrated amalgamation of the best Technical SEO, Semantic Clustering, and E-E-A-T skills.

## Layer 1: Technical SEO & Metadata Enforcement

The most basic layer of SEO is often overlooked. You must enforce these automatically:

* **Title & Meta Tags:** Every page or route MUST have a descriptive `<title>` and a `<meta name="description">`. If you detect a route missing these, modify the router or layout component to enforce a required metadata payload.
* **Canonical URLs:** Ensure that dynamically generated content includes `<link rel="canonical" href="...">` to prevent duplicate content penalties.
* **Open Graph & Social:** If modifying a page template, automatically include `og:title`, `og:description`, and `og:image` tags.

## Layer 2: Semantic HTML & Accessibility Healing

Bad structure confuses crawlers. If you see generic `<div>` soup, you must heal it.

* **Heading Hierarchy:** Enforce exactly one `<h1>` per page. Subsections must strictly follow `<h2>`, `<h3>`, etc., without skipping levels. 
* **Semantic Tags:** Replace generic wrappers with `<article>`, `<section>`, `<nav>`, `<aside>`, and `<footer>` where applicable.
* **Image Accessibility:** If you encounter `<img>` tags without `alt` attributes, you must either add a descriptive `alt` based on the context or enforce a strict linting rule that prevents missing `alt` text.

## Layer 3: Advanced Schema Markup (JSON-LD)

To dominate rich snippets, structured data is mandatory.

* **Auto-Injection:** When creating or modifying data models (like Blog Posts, Products, or Recipes), automatically generate the corresponding JSON-LD schema markup.
* **Validation:** Ensure the schema strictly maps to Schema.org standards. Inject the JSON-LD script block securely in the document `<head>`.

## Layer 4: Content E-E-A-T & Quality Gates (The Adversarial Gate)

Google prioritizes Experience, Expertise, Authoritativeness, and Trustworthiness.

* **Author Attribution:** Ensure content rendering components explicitly link to an author profile with appropriate `rel="author"` attributes.
* **Fact & Link Checking:** If generating or formatting content, ensure external links use `rel="noopener noreferrer"` and, when appropriate for user-generated content, `rel="nofollow"`.
* **Readability & Clustering:** Organize long-form text with clear bullet points, bolded key terms, and semantic clusters to improve crawlability and user retention.

## Actionable Interceptors (The Healing Pattern)

Similar to the `mysql-mcp-heal` sandbox interceptors, apply these concepts to web architectures:
* **Missing Metadata Interceptor:** If a Next.js/Vite page attempts to render without a title, throw an explicit guidance error in development mode: *"Attempted to render page without SEO metadata. Did you forget to export a 'metadata' object?"*
* **Heading Linter:** Add static analysis or runtime checks that fail the build if multiple `<h1>` tags are detected on a single route.

## Layer 5: Cloudflare Edge SEO (Pages & Workers)

Since this project primarily utilizes Cloudflare, you must leverage the Edge for SEO:
* **Edge Caching for Bots:** Ensure Cloudflare caching rules explicitly accommodate `Googlebot` and other major crawlers to ensure lightning-fast time-to-first-byte (TTFB).
* **HTMLRewriter Injection:** If backend metadata is missing or dynamic, use Cloudflare's `HTMLRewriter` in a Worker or Pages Function to inject `<title>`, `<meta>`, and JSON-LD tags on the fly before it reaches the crawler.
* **Redirects & Status Codes:** Enforce strict 301 redirects at the Cloudflare Pages/Worker level (using `_redirects` or Worker logic) for any deprecated URLs. Ensure a 404 status is returned natively at the edge for missing pages.
