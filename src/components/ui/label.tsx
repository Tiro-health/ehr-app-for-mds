import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * @summary Standalone `<label>` for controls not wrapped in `Field`; inside a `Field` use its `label` prop instead.
 *
 * @category Primitives
 */
export function Label({ className, ...props }: ComponentProps<'label'>) {
  return (
    <label
      data-slot="label"
      className={cn(
        'flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
