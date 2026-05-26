---
title: Use Activity Component for Show/Hide
impact: MEDIUM
impactDescription: preserves state/DOM
tags: rendering, activity, visibility, state-preservation
---

## Use CSS Visibility for Expensive Show/Hide

To preserve state/DOM for expensive components that frequently toggle visibility, use CSS `display: none` rather than conditionally unmounting them from the tree (unless using experimental React `<Activity>` / Offscreen APIs).

**Usage:**

```tsx
function Dropdown({ isOpen }: Props) {
  return (
    <div style={{ display: isOpen ? 'block' : 'none' }}>
      <ExpensiveMenu />
    </div>
  )
}
```

Avoids expensive re-mounts and state loss for heavy subtrees.
