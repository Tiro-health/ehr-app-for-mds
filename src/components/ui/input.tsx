import type { ComponentProps } from 'react'
import { Input as BaseInput } from '@base-ui/react/input'
import { FIELD_STATE_CLASSES } from '@/components/ui/field-states'
import { cn } from '@/lib/utils'

export interface InputProps extends Omit<ComponentProps<typeof BaseInput>, 'size'> {
  /** `sm` is `h-8` with 13px text from `md:` up, for dense surfaces; matches `SelectTrigger size="sm"`. */
  size?: 'default' | 'sm'
}

/**
 * Text input built on Base UI's `Input`, themed with shadcn CSS-variable tokens.
 * A thin styled wrapper — forwards every Base UI input prop (including `render`
 * for composition and the Field a11y wiring) and merges `className` via `cn`.
 *
 * @summary Single-line text input; wrap in `Field` for label and error, use `InputGroup` for icons or buttons inside the frame, `Textarea` for multi-line.
 *
 * @category Primitives
 */
export function Input({ className, size = 'default', ...props }: InputProps) {
  return (
    <BaseInput
      className={cn(
        'flex w-full rounded-md border border-input bg-field px-3 py-1 shadow-sm transition-colors placeholder:text-muted-foreground',
        FIELD_STATE_CLASSES,
        size === 'sm' ? 'h-8 text-base md:text-[0.8125rem]' : 'h-9 text-base md:text-sm',
        className,
      )}
      {...props}
    />
  )
}
