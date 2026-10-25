import type { Bag } from '../schemas/round';
import { PUTTER, shortName } from '../lib/clubs';
import { cn } from '../lib/utils';

export function ClubPicker({ bag, selected, onPick }: { bag: Bag; selected: string | null; onPick: (club: string) => void }) {
  return <div aria-label="Choose club" className="flex flex-wrap justify-center gap-2 rounded-3xl bg-[rgb(12_14_13/0.94)] p-3 text-white shadow-xl backdrop-blur">
    {bag.clubs.filter(c => c.on && c.id !== PUTTER).map(c => <button key={c.id} type="button" onClick={() => onPick(c.id)}
      aria-label={`${c.name}, stock ${c.stock == null ? 'not set' : `${c.stock} yards`}`} aria-pressed={selected === c.id}
      className={cn('grid min-h-14 min-w-14 place-content-center rounded-full border border-white/25 px-2 text-center leading-tight',
        selected === c.id ? 'border-orange bg-orange text-orange-foreground' : 'bg-white text-[#17251c]')}>
      <b className="text-sm">{shortName(c.name)}</b><span className="mt-1 text-[10px]">{c.stock == null ? 'No stock' : `${c.stock} y stock`}</span>
    </button>)}
  </div>;
}
