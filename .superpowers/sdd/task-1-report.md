# Task 1: Toast Notification Component — Report

## What I Implemented

### `src/components/Toast.tsx` (new file)
- **`'use client'` directive** at top
- **`ToastContext`** created via `React.createContext<ToastContextValue | null>(null)`
- **`ToastProvider`** component (named export):
  - Wraps children and renders a fixed-position toast container at bottom-right
  - Manages `toasts` state array of `{ id, message, type }` objects
  - Container uses `zIndex: 'var(--z-toast, 1400)'` (falls back to 1400)
  - Container has `pointerEvents: 'none'` so it doesn't block clicks; individual toasts re-enable `pointerEvents: 'auto'`
- **`ToastCard`** internal component:
  - Auto-dismisses after 4 seconds via `setTimeout` in a `useEffect` keyed on `toast.id`
  - Manual close button with `X` icon from lucide-react (`aria-label="Close notification"`)
  - 4 color variants using CSS design tokens:
    - **success**: `--color-success-50` (bg), `--color-success-500` (border/icon), `--color-success-700` (text)
    - **error**: `--color-danger-50` (bg), `--color-danger-500` (border/icon), `--color-danger-700` (text)
    - **warning**: `--color-warning-50` (bg), `--color-warning-500` (border/icon), `--color-warning-600` (text)
    - **info**: `--color-primary-50` (bg), `--color-primary-500` (border/icon), `--color-primary-700` (text)
  - Each variant has an appropriate icon: `CheckCircle`, `AlertCircle`, `AlertTriangle`, `Info`
  - Slide-in animation via `@keyframes toastSlideIn` added to globals.css
- **`useToast()`** hook (named export):
  - Uses `useContext(ToastContext)`
  - Throws `Error('useToast must be used within a ToastProvider')` if used outside provider
  - Returns `{ toast: (message, type?) => void }` with default type `'info'`

### `src/app/layout.tsx` (modified)
- Added import: `import { ToastProvider } from "@/components/Toast"`
- Wrapped `{children}` with `<ToastProvider>{children}</ToastProvider>` inside `<body>`

### `src/styles/globals.css` (modified)
- Added `@keyframes toastSlideIn` animation after the existing `@keyframes spin`

## What I Tested and Test Results

| Test | Command | Result |
|------|---------|--------|
| TypeScript type check | `npx tsc --noEmit` | **PASS** — 0 errors |
| Production build | `npm run build` | **PASS** — all 21 routes built successfully |

## Files Changed

1. `src/components/Toast.tsx` — **created** (134 lines)
2. `src/app/layout.tsx` — **modified** (added ToastProvider import + wrapped children)
3. `src/styles/globals.css` — **modified** (added `toastSlideIn` keyframe animation)

## Self-Review Findings

1. **Auto-dismiss cleanup**: The `useEffect` in `ToastCard` properly cleans up the `setTimeout` timer on unmount via `return () => clearTimeout(timer)`. The effect depends on `[toast.id, onClose]` — `onClose` is stable because `removeToast` is wrapped in `useCallback`. This ensures the timer doesn't leak.

2. **ID generation**: Toast IDs use `Date.now()` + random string suffix, which is sufficient for client-side uniqueness. No need for `crypto.randomUUID()` since this isn't a security context.

3. **No comments in code**: As specified, no comments were added.

4. **Inline styles**: Used inline styles for positioning/layout and CSS design token variables for colors, as instructed. The `toastSlideIn` animation references a keyframe in globals.css since inline styles can't define keyframes.

5. **Design token usage**: All color variants reference existing CSS custom properties from `globals.css`. The `--z-toast` token (defined as 1400 in globals.css) is used with a fallback of `1400`.

6. **Minor concern**: The `toastSlideIn` animation name is added to globals.css rather than being self-contained in the component file. This is necessary because CSS `@keyframes` cannot be defined via inline styles. The alternative would be using a `<style>` tag within the component, but that's less clean. This is an acceptable tradeoff.
