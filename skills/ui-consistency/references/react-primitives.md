# React primitives: reference implementation

Stack: React 19, Tailwind CSS v4, `class-variance-authority`, `clsx`, `tailwind-merge`, Radix UI.
Install: `npm i class-variance-authority clsx tailwind-merge radix-ui`

## 1. Tokens (`src/app/globals.css`)

Name tokens by role. Tailwind v4 generates utilities from `@theme`: `--text-label` → `text-label`.

```css
@theme {
  --text-label-xs: 10px;
  --text-label-xs--line-height: 1;
  --text-label: 11px;
  --text-body: 14px;
  --text-title: 18px;

  --radius-card: 1rem;
  --radius-pill: 9999px;

  --color-status-success: #059669;
  --color-status-success-bg: rgb(16 185 129 / 0.08);
}
```

## 2. `cn()` helper (`src/lib/cn.ts`)

`tailwind-merge` must know your custom font-size tokens. Otherwise it treats `text-label` as a *colour*
and silently drops `text-primary` (or the reverse).

```ts
import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['label-xs', 'label', 'body', 'title'] }],
      rounded: [{ rounded: ['card', 'pill'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Keep the list in sync with `@theme`; a unit test should compare both.

## 3. A variant primitive (`src/components/ui/Button.tsx`)

```tsx
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import { cn } from '@/lib/cn';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 font-semibold transition active:scale-95 disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-on-primary',
        secondary: 'bg-surface-container text-on-surface',
        ghost: 'text-primary hover:bg-surface-container-low',
        danger: 'bg-error text-on-error',
      },
      size: {
        sm: 'h-8 px-3 text-label rounded-lg',
        md: 'h-10 px-4 text-body rounded-xl',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
```

Usage: `<Button variant="ghost" size="sm" className="mt-2">Speichern</Button>`. `className` is for layout only.

## 4. An interactive primitive on Radix (`src/components/ui/Dialog.tsx`)

Recommended option. Radix brings focus trap, ESC, scroll lock, `aria-*` and portal, and you only style it. A project that keeps its own dialog follows the same shape (`Dialog`, `DialogContent`, `DialogTitle` exported from `components/ui`), and every overlay in the app uses it.

```tsx
import { Dialog as R } from 'radix-ui';
import { cn } from '@/lib/cn';

export const Dialog = R.Root;
export const DialogTrigger = R.Trigger;
export const DialogClose = R.Close;

export function DialogContent({ className, children, ...props }: React.ComponentProps<typeof R.Content>) {
  return (
    <R.Portal>
      <R.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
      <R.Content
        className={cn('fixed left-1/2 top-1/2 z-50 w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2 rounded-card bg-surface-container-lowest p-6', className)}
        {...props}
      >
        {children}
      </R.Content>
    </R.Portal>
  );
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof R.Title>) {
  return <R.Title className={cn('text-title font-semibold text-on-surface', className)} {...props} />;
}
```

## 5. A compound primitive (`src/components/ui/Card.tsx`)

```tsx
import { cn } from '@/lib/cn';

function CardRoot({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('rounded-card bg-surface-container-lowest shadow-sm', className)} {...props} />;
}
function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex items-center justify-between px-4 pt-4', className)} {...props} />;
}
function CardBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('px-4 pb-4', className)} {...props} />;
}

export const Card = Object.assign(CardRoot, { Header: CardHeader, Body: CardBody });
```

## 6. Visual regression guard for refactors

Before moving existing UI onto primitives, freeze how it looks (`@playwright/test`):

```ts
// tests/visual/screens.spec.ts
import { test, expect } from '@playwright/test';

const SCREENS = ['/cockpit', '/tickets', '/raum'];

for (const url of SCREENS) {
  test(`looks unchanged: ${url}`, async ({ page }) => {
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot({ fullPage: true, animations: 'disabled', maxDiffPixels: 0 });
  });
}
```

Run with fixed viewport, fixed fonts, seeded emulator data, and the same OS/browser as the baseline (best: in CI
or a Docker image). Snapshots are updated only with explicit human approval (`--update-snapshots`).
