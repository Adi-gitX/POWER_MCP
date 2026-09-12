import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold tracking-wide',
  {
    variants: {
      tone: {
        blue: 'border-blue-line bg-blue-wash text-blue-ink',
        pass: 'border-pass/25 bg-pass-wash text-pass',
        refuse: 'border-refuse/25 bg-refuse-wash text-refuse',
        neutral: 'border-line-2 bg-paper-2 text-ink-2',
        solid: 'border-transparent bg-blue text-white',
      },
      size: { xs: 'text-[0.62rem]', sm: 'text-[0.72rem]' },
    },
    defaultVariants: { tone: 'neutral', size: 'sm' },
  },
);

export function Badge({ className, tone, size, ...props }: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone, size, className }))} {...props} />;
}
