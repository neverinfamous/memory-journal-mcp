## 4. Component Patterns

### Buttons

```html
<button
  class="
  inline-flex items-center justify-center
  rounded-lg px-4 py-2
  bg-primary-500 text-white font-medium
  hover:bg-primary-600
  focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500
  active:scale-[0.98]
  disabled:opacity-50 disabled:cursor-not-allowed
  transition-all duration-150
"
>
  Click me
</button>
```

### Cards

```html
<article
  class="
  rounded-xl border border-gray-200 dark:border-gray-700
  bg-white dark:bg-gray-800
  p-6 shadow-sm
  hover:shadow-md transition-shadow
"
>
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
