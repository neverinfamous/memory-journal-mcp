---
name: tailwind-css
description: |
  Master Tailwind CSS v4 with its CSS-first configuration paradigm. Use when
  writing utility classes, configuring design tokens via @theme, implementing
  dark mode, migrating from v3, or integrating with React/Vue/Svelte. Triggers
  on "Tailwind", "utility CSS", "Tailwind v4", "@theme", "dark mode classes",
  "responsive design", "Tailwind migration".
---

# Tailwind CSS v4 Engineering Standards

This skill codifies Tailwind CSS v4's **CSS-first architecture** — the paradigm shift from JavaScript configuration to native CSS-based theming and customization.

## 1. Core Paradigm: CSS-First Configuration

### Entry Point

Replace all legacy directives with a single import:

```css
/* main.css */
@import "tailwindcss";
```

- **NEVER** use `@tailwind base; @tailwind components; @tailwind utilities;` — this is v3 syntax
- **No `tailwind.config.js` needed** for most projects — CSS is the single source of truth
- Use `@config "./tailwind.config.js"` only for legacy migration or PostCSS plugin compatibility

### The `@theme` Directive

All design tokens are defined directly in CSS:

```css
@import "tailwindcss";

@theme {
  /* Colors */
  --color-primary-50: #eff6ff;
  --color-primary-500: #3b82f6;
  --color-primary-900: #1e3a5a;

  /* Typography */
  --font-display: "Inter", sans-serif;
  --font-mono: "JetBrains Mono", monospace;

  /* Spacing */
  --spacing-container: 1200px;

  /* Border Radius */
  --radius-card: 0.75rem;
}
```

- Tailwind **automatically generates utility classes** from `@theme` variables
- `--color-primary-500` → `bg-primary-500`, `text-primary-500`, `border-primary-500`
- `--font-display` → `font-display`
- Tokens are native CSS variables — inspectable in browser DevTools

## 2. Dark Mode

### Configuration (v4 Pattern)

```css
/* Class-based dark mode (most common) */
@custom-variant dark (&:where(.dark, .dark *));
```

### Usage in HTML

```html
<div class="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
  <h1 class="text-primary-500 dark:text-primary-300">Title</h1>
</div>
```

### System Preference (Default)

By default, Tailwind v4 respects `prefers-color-scheme`. If you want manual class toggle control, use `@custom-variant dark` as shown above.

### Toggle Implementation

```javascript
// Toggle dark mode via JavaScript
document.documentElement.classList.toggle("dark");

// Or persist to localStorage
const isDark = localStorage.getItem("theme") === "dark";
document.documentElement.classList.toggle("dark", isDark);
```

## 3. Responsive Design

### Mobile-First Breakpoints

Tailwind uses a **mobile-first** approach — unprefixed utilities apply to all screens, prefixed utilities apply at that breakpoint and above.

```html
<!-- Full width on mobile, half on md, third on lg -->
<div class="w-full md:w-1/2 lg:w-1/3">...</div>

<!-- Stack on mobile, row on sm+ -->
<div class="flex flex-col sm:flex-row gap-4">...</div>
```

### Default Breakpoints

| Prefix | Min Width | Target |
|--------|----------|--------|
| `sm` | 640px | Small tablets |
| `md` | 768px | Tablets |
| `lg` | 1024px | Laptops |
| `xl` | 1280px | Desktops |
| `2xl` | 1536px | Large screens |

### Custom Breakpoints

```css
@theme {
  --breakpoint-xs: 475px;
  --breakpoint-3xl: 1920px;
}
```

## 4. Component Patterns

### Buttons

```html
<button class="
  inline-flex items-center justify-center
  rounded-lg px-4 py-2
  bg-primary-500 text-white font-medium
  hover:bg-primary-600
  focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500
  active:scale-[0.98]
  disabled:opacity-50 disabled:cursor-not-allowed
  transition-all duration-150
">
  Click me
</button>
```

### Cards

```html
<article class="
  rounded-xl border border-gray-200 dark:border-gray-700
  bg-white dark:bg-gray-800
  p-6 shadow-sm
  hover:shadow-md transition-shadow
">
  <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Title</h3>
  <p class="mt-2 text-gray-600 dark:text-gray-400">Description text.</p>
</article>
```

### Custom Component Classes

```css
@layer components {
  .btn-primary {
    @apply inline-flex items-center justify-center rounded-lg px-4 py-2
           bg-primary-500 text-white font-medium
           hover:bg-primary-600 transition-colors;
  }
}
```

- **Use `@layer components`** for reusable component styles
- **Prefer utility classes inline** for one-off styling
- **Use `@apply` sparingly** — only for highly-repeated patterns

## 5. Animations & Transitions

### Built-in Transitions

```html
<!-- Smooth hover effect -->
<div class="transition-all duration-300 ease-in-out hover:scale-105">

<!-- Color transitions only -->
<a class="transition-colors duration-150 text-gray-500 hover:text-primary-500">
```

### Custom Animations

```css
@theme {
  --animate-fade-in: fade-in 0.3s ease-out;
  --animate-slide-up: slide-up 0.4s ease-out;
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slide-up {
  from { opacity: 0; transform: translateY(1rem); }
  to { opacity: 1; transform: translateY(0); }
}
```

Usage: `class="animate-fade-in"` or `class="animate-slide-up"`

## 6. Migration from v3 to v4

### Step-by-Step

1. **Update package**: `pnpm add -D tailwindcss@latest`
2. **Replace CSS entry point**:
   - Remove: `@tailwind base; @tailwind components; @tailwind utilities;`
   - Add: `@import "tailwindcss";`
3. **Migrate `tailwind.config.js`** → `@theme` block in CSS
4. **Update dark mode**: Replace `darkMode: "class"` config with `@custom-variant dark`
5. **Check defaults**: Some defaults changed (e.g., border colors). Verify visually.
6. **Remove PostCSS plugins** if no longer needed (v4 has its own engine)

### Key Breaking Changes

| v3 | v4 |
|----|-----|
| `tailwind.config.js` | `@theme` in CSS |
| `darkMode: "class"` | `@custom-variant dark (...)` |
| `@tailwind base/components/utilities` | `@import "tailwindcss"` |
| `theme.extend.colors` | `--color-*` in `@theme` |
| `theme.extend.fontFamily` | `--font-*` in `@theme` |

## 7. Anti-Patterns (Never Do These)

| Anti-Pattern | Why It's Wrong | Do This Instead |
|-------------|---------------|-----------------|
| `@apply` everywhere | Defeats utility-first purpose, harder to maintain | Use inline utilities; `@apply` only for highly-repeated patterns |
| `!important` classes | Specificity wars, unpredictable cascade | Use proper specificity layers |
| Arbitrary values excessively (`text-[17px]`) | Breaks design system consistency | Define tokens in `@theme` |
| Inline `style=` alongside utilities | Mixed paradigms, inconsistent | All styling via Tailwind utilities |
| Using v3 `tailwind.config.js` in v4 | Unnecessary JS dependency | Migrate to `@theme` in CSS |
| Not using `dark:` variants | Inaccessible for dark-mode users | Always implement dark mode |
| Ignoring mobile-first | Desktop-only layouts break on phones | Design mobile-first, add breakpoints up |

## 8. Accessibility Essentials

- **Always use `focus-visible:`** for keyboard focus indicators — never remove focus outlines without replacement
- **Ensure color contrast** — text must meet WCAG AA (4.5:1 normal, 3:1 large)
- **Use `sr-only`** class for screen-reader-only text on icon buttons
- **Never use `hidden`** for content that should be accessible — use `sr-only` instead

```html
<button class="p-2 rounded-lg hover:bg-gray-100 focus-visible:ring-2">
  <svg class="size-5" aria-hidden="true">...</svg>
  <span class="sr-only">Close menu</span>
</button>
```
