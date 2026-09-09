import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent/10',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        /*
         * 🔴 `type="button"` IS NOT COSMETIC HERE, IT IS THE DIFFERENCE BETWEEN
         * A WORKING SCREEN AND A BLANK PAGE.
         *
         * A <button> with no type defaults to type="submit". In its default
         * mode this app is served as an INLINEHTML field INSIDE a NetSuite
         * serverWidget form, so every untyped button submitted that form: the
         * browser POSTed the host Suitelet, which only answers GET, and the
         * trader landed on a blank page reading {"error":"Method not allowed"}.
         * Marc-Antoine hit it on the toolbar Refresh on 2026-09-09.
         *
         * It hid because FULLSCREEN mode builds its own HTML document with no
         * NS form, so there is nothing to submit and every button behaves. Most
         * of our own testing is fullscreen.
         *
         * Placed BEFORE {...props} deliberately, so a caller that really wants
         * to submit still can by passing type="submit" — which is exactly what
         * the one real <form> in this app, CreateOrderModal, already does.
         * Skipped for asChild, where Slot renders someone else's element and
         * that element may not be a button at all.
         */
        {...(asChild ? {} : { type: 'button' as const })}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
