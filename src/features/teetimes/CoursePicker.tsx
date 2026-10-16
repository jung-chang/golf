// Courses as four borough panels (Bronx, Queens / Staten Island, Brooklyn) meeting at a Manhattan hub.
import { courseByCode, PICKER } from '@/lib/nyc';
import { cn } from '@/lib/utils';

export function CoursePicker({ selected, onToggle }: { selected: string[]; onToggle: (code: string) => void }) {
  const panel = (i: number) => {
    const { borough, rows } = PICKER[i];
    const right = i % 2 === 1;
    const bottom = i >= 2;
    return (
      <div
        key={borough}
        role="group"
        aria-label={borough}
        className={cn('relative grid grid-cols-2 content-start gap-1.5 rounded-[22px] border-2 border-primary p-2 pt-7', bottom && 'pt-8')}
      >
        <span className={cn('absolute top-2 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase', right ? 'right-3.5' : 'left-3.5')}>
          {borough}
        </span>
        {rows.flat().map((code, j) => {
          const c = code ? courseByCode(code) : undefined;
          if (!code || !c) return <div key={j} aria-hidden="true" />;
          const on = selected.includes(code);
          return (
            <button
              key={code}
              type="button"
              aria-pressed={on}
              aria-label={`${c.name}${c.badge ? `, ${c.badge}` : ''}${c.tenant ? '' : ', no live times'}`}
              onClick={() => onToggle(code)}
              className={cn(
                'grid min-h-14 place-content-center rounded-xl border-[1.5px] bg-background px-0.5 py-1 text-center transition-colors active:scale-95',
                c.badge && 'border-dashed',
                !c.tenant && !on && 'opacity-50',
                on && 'border-primary bg-primary text-primary-foreground',
              )}
            >
              <span className="text-base leading-tight font-extrabold">{code}</span>
              <span className="text-[10.5px] leading-tight opacity-80">{c.name}</span>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">{panel(0)}{panel(1)}</div>
      <div className="relative grid grid-cols-2 gap-2">
        {panel(2)}{panel(3)}
        {/* Manhattan: where the four boroughs meet. */}
        <div
          aria-hidden="true"
          className="absolute top-[-4px] left-1/2 grid size-14 -translate-x-1/2 -translate-y-1/2 place-content-center rounded-full border-2 border-primary bg-background text-center text-[8.5px] leading-tight font-bold tracking-[0.1em] text-primary ring-[6px] ring-background"
        >
          MAN<br />HATTAN
        </div>
      </div>
      <p className="text-center text-xs text-muted-foreground">Dashed: short course or pitch &amp; putt</p>
    </div>
  );
}
