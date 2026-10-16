// Building blocks every screen shares: a header, grouped lists (settings style) and empty states.
import type { ComponentProps, ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Screen header: a big title (or a back button and a small one) with actions on the right. */
export function PageHeader({ title, sub, back, actions }: {
  title: ReactNode; sub?: ReactNode; back?: () => void; actions?: ReactNode;
}) {
  return (
    <header className={cn('flex items-center gap-1 px-4 pt-4 pb-2', back && 'pl-1')}>
      {back && (
        <Button variant="ghost" size="icon" className="size-11 shrink-0" aria-label="Back" onClick={back}>
          <ChevronLeft className="size-6" />
        </Button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className={cn('truncate font-bold tracking-tight', back ? 'text-lg' : 'text-[1.75rem] leading-tight')}>{title}</h1>
        {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
      </div>
      {actions && <div className="-mr-2 flex shrink-0 items-center">{actions}</div>}
    </header>
  );
}

/** Icon button with an optional count dot, for header actions. */
export function IconAction({ label, count, children, className, ...props }: ComponentProps<typeof Button> & { label: string; count?: number }) {
  return (
    <Button variant="ghost" size="icon" aria-label={count ? `${label} (${count} new)` : label} className={cn('relative size-11', className)} {...props}>
      {children}
      {!!count && (
        <span className="absolute top-1.5 right-1.5 min-w-4 rounded-full bg-orange px-1 text-center text-[0.625rem] leading-4 font-bold text-orange-foreground tabular-nums">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </Button>
  );
}

/** A titled group of rows on a card, like a phone's Settings screen. */
export function Group({ title, aside, children, className }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-1.5', className)}>
      {(title || aside) && (
        <div className="flex items-end justify-between px-1">
          {title && <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h2>}
          {aside}
        </div>
      )}
      <div className="divide-y overflow-hidden rounded-2xl border bg-card">{children}</div>
    </section>
  );
}

/** One row in a Group. With href or onClick it's tappable and gets a chevron. */
export function Row({ icon, label, sub, value, href, onClick, className, children }: {
  icon?: ReactNode; label: ReactNode; sub?: ReactNode; value?: ReactNode;
  href?: string; onClick?: () => void; className?: string; children?: ReactNode;
}) {
  const tappable = !!(href || onClick);
  const body = (
    <>
      {icon && <span className="grid size-8 shrink-0 place-content-center rounded-lg bg-accent text-accent-foreground [&_svg]:size-4">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.9375rem]">{label}</span>
        {sub && <span className="block text-xs text-muted-foreground">{sub}</span>}
      </span>
      {value !== undefined && <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{value}</span>}
      {children}
      {tappable && <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />}
    </>
  );
  const cls = cn('flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left', tappable && 'active:bg-accent', className);
  if (href) return <a href={href} className={cls}>{body}</a>;
  if (onClick) return <button type="button" onClick={onClick} className={cls}>{body}</button>;
  return <div className={cls}>{body}</div>;
}

/** Nothing here yet: an icon, a sentence, and the one thing to do about it. */
export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-8 py-12 text-center">
      <span className="mb-3 grid size-14 place-content-center rounded-full bg-accent text-accent-foreground [&_svg]:size-6">{icon}</span>
      <p className="font-semibold">{title}</p>
      {children && <p className="mt-1 text-sm text-muted-foreground">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Initials in a circle, for members. */
export function Initials({ name, max = 2, className }: { name: string; max?: number; className?: string }) {
  const letters = name.split(/[\s._-]+/).filter(Boolean).slice(0, max).map((w) => w[0]!.toUpperCase()).join('') || '?';
  return (
    <span aria-hidden="true" className={cn('grid size-8 shrink-0 place-content-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground', className)}>
      {letters}
    </span>
  );
}
