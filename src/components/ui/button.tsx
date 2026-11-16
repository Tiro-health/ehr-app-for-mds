import type { ComponentProps } from 'react'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Button primitive (shadcn CSS-variable tokens).
 *
 * The variant/size sets are a superset so one button serves both consumers:
 * the house primitives use `primary | secondary | ghost | danger` and `sm | md`,
 * while stock shadcn-style primitives reach for `default | outline |
 * destructive | link` and `default | lg | icon | icon-sm`. `primary`/`md`
 * remain the defaults and the original variant classes are unchanged.
 *
 * `shape` picks the corner radius. House rule:
 *
 * - **`pill`** — page-level CTAs (`+ Categorie toevoegen`), navigation/toolbar
 *   controls (Vandaag, prev/next, view switchers), segmented selectors
 *   (Bestaande / Nieuwe patiënt), and
 *   empty-state primary actions. Anything that sits in page chrome.
 * - **`rounded`** (default) — form-control height. Use inside forms: footer
 *   actions (`Opslaan` / `Annuleer`, every `type="submit"`), inline buttons
 *   that align with input fields, three-dot / icon-sm row actions, and
 *   destructive confirmations inside a dialog.
 *
 * Rule of thumb: ask "is this *opening* a form, or *inside* one?" Opening →
 * pill; inside → rounded. Don't mix the two in the same row.
 *
 * **Icons.** Every size sizes its own icon child and, when that icon leads a
 * label (`+ Nieuw`, `+ Afspraak`), widens the padding on the text side —
 * an icon reads optically lighter than a letterform, so symmetric padding
 * leaves the label crowded against the trailing edge. Both halves are
 * automatic, so a call site writes `<Plus aria-hidden />` and nothing else;
 * pass an explicit `size-*` on the icon only to override deliberately (the
 * auto-size skips any icon that already carries one, the same way
 * `inputGroupButtonVariants` does).
 *
 * An **icon-only** button must use `size="icon"` / `size="icon-sm"`, which
 * carry no horizontal padding and so stay square; a lone icon in a text size
 * would pick up the leading-icon padding and render off-centre.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground',
        ghost: 'text-foreground hover:bg-accent hover:text-accent-foreground',
        // `ghost` in the brand colour: an inline text action that reads as interactive at rest,
        // where `ghost` waits for a hover to say so. Distinct from `link`, which underlines.
        accent: 'text-accent-foreground hover:bg-accent',
        danger: 'border border-destructive/30 bg-background text-destructive hover:bg-destructive/10',
        // shadcn-style aliases/additions: `default` mirrors `primary`,
        // `outline` mirrors `secondary`; `destructive` is a solid (high-emphasis)
        // red and `link` an inline text button.
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        link: 'text-primary underline-offset-4 hover:underline',
        // `ghost` on a black surface: the compare studio and annotation toolbars.
        'ghost-on-dark': 'text-white hover:bg-white/10 hover:text-white',
      },
      size: {
        // Two icon rules per size. `[&>svg:not([class*="size-"])]` sizes an icon child that hasn't
        // asked for a size itself, so the convention can't drift call site by call site; the
        // `has-[>svg:first-child]` bump then pads the side opposite a LEADING icon. The icon-only
        // sizes take the first rule and deliberately not the second.
        sm: 'h-7 px-2 text-xs has-[>svg:first-child]:pr-3 [&>svg:not([class*="size-"])]:size-3.5',
        md: 'h-9 px-3.5 text-sm has-[>svg:first-child]:pr-4.5 [&>svg:not([class*="size-"])]:size-4',
        // shadcn-style additions: `default` mirrors `md`.
        default: 'h-9 px-3.5 text-sm has-[>svg:first-child]:pr-4.5 [&>svg:not([class*="size-"])]:size-4',
        lg: 'h-10 px-5 text-sm has-[>svg:first-child]:pr-6 [&>svg:not([class*="size-"])]:size-4',
        icon: 'h-9 w-9 [&>svg:not([class*="size-"])]:size-4',
        'icon-sm': 'h-7 w-7 [&>svg:not([class*="size-"])]:size-4',
      },
      shape: {
        rounded: 'rounded-md',
        pill: 'rounded-full',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
      shape: 'rounded',
    },
  },
)

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {}

/**
 * Clickable action element with visual variants and sizes.
 *
 * @summary Use for any action that does something on click; for a status pill use `Badge`, and for a destructive confirmation go through `ConfirmFn`, not `window.confirm`.
 *
 * @category Primitives
 */
export function Button({ variant, size, shape, className, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size, shape }), className)} {...props} />
}

export { buttonVariants }
