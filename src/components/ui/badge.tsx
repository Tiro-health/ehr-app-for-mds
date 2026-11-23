import { useRender } from '@base-ui/react/use-render'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const badgeVariants = cva('inline-flex items-center rounded-full font-medium [&>svg]:shrink-0', {
  variants: {
    tone: {
      default: 'bg-primary/15 text-primary',
      secondary: 'bg-secondary text-secondary-foreground',
      muted: 'bg-muted text-muted-foreground',
      success: 'bg-success/15 text-success',
      warning: 'bg-warning/15 text-warning',
      info: 'bg-info/15 text-info',
      destructive: 'bg-destructive/15 text-destructive',
      // Categorical, not semantic: a muted purple for a fourth category beside warning, info and muted.
      violet:
        'bg-[oklch(95.5%_0.015_290)] text-[oklch(48%_0.06_290)] dark:bg-[oklch(31%_0.025_290)] dark:text-[oklch(82%_0.05_290)]',
      outline: 'border border-border text-foreground',
    },
    size: {
      sm: 'gap-1 px-2 py-0.5 text-2xs leading-4 [&>svg]:size-3',
      md: 'gap-1.5 px-2.5 py-1 text-xs [&>svg]:size-3.5',
    },
  },
  defaultVariants: {
    tone: 'default',
    size: 'md',
  },
})

export interface BadgeProps extends useRender.ComponentProps<'span'>, VariantProps<typeof badgeVariants> {
  /** Render a leading status dot that inherits the badge's text color. */
  dot?: boolean
  /** When set, the badge becomes a removable chip with a trailing ✕ button. */
  onRemove?: () => void
  /** Accessible label for the remove button — required when `onRemove` is set. */
  removeLabel?: string
  /** Disables the remove button (no effect without `onRemove`). */
  removeDisabled?: boolean
}

/**
 * Inline label for status, category, or semantic context. `size="sm"` gives a compact chip;
 * pass `onRemove` to turn it into a removable chip (the label truncates, the ✕ stays pinned).
 * Serves as a Base UI `render` target (e.g. a `Combobox.Chip`), and takes `render` itself to
 * become a native control: `<Badge render={<button type="button" />}>`. The size owns direct `svg` icons' size.
 *
 * @summary Use for every tone-colored pill (status, category, active/inactive); never hand-roll a second color map. For a clickable control use `Button`.
 *
 * @category Primitives
 */
export function Badge({
  tone,
  size,
  dot = false,
  onRemove,
  removeLabel,
  removeDisabled,
  className,
  children,
  render,
  ref,
  ...props
}: BadgeProps) {
  return useRender({
    render: render ?? <span />,
    ref,
    props: {
      ...props,
      className: cn(
        badgeVariants({ tone, size }),
        render != null && 'outline-none focus-visible:ring-2 focus-visible:ring-ring',
        onRemove != null && 'pr-1',
        className,
      ),
      children: (
        <>
          {dot ? <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden /> : null}
          {onRemove != null ? <span className="min-w-0 truncate">{children}</span> : children}
          {onRemove != null ? (
            <button
              type="button"
              aria-label={removeLabel}
              disabled={removeDisabled}
              onClick={(e) => {
                e.stopPropagation()
                onRemove()
              }}
              className="inline-flex size-4 shrink-0 items-center justify-center rounded-full opacity-70 transition-colors hover:bg-foreground/10 hover:opacity-100 disabled:opacity-40"
            >
              <X className="size-3" aria-hidden />
            </button>
          ) : null}
        </>
      ),
    },
  })
}
