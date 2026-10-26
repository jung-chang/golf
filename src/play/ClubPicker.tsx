import { Check } from 'lucide-react';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import type { Bag } from '../schemas/round';
import { PUTTER, shortName } from '../lib/clubs';
import { cn } from '../lib/utils';

export function ClubPicker({ bag, selected, open, includePutter = false, onClose, onPick }: {
  bag: Bag; selected: string | null; open: boolean; includePutter?: boolean; onClose: () => void; onPick: (club: string) => void;
}) {
  const choices = bag.clubs.filter(c => c.on && c.id !== PUTTER);
  if (includePutter) choices.push(bag.clubs.find(c => c.id === PUTTER) ?? { id: PUTTER, name: 'Putter', stock: null, on: true });
  return <Drawer open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <DrawerContent className="bg-[#f7f8f5] text-[#172b21]">
      <DrawerHeader className="pb-4"><DrawerTitle>Choose club</DrawerTitle><DrawerDescription>Stock yardages · tap to select</DrawerDescription></DrawerHeader>
      <div className="overflow-y-auto overscroll-contain px-4 pb-5" data-vaul-no-drag>
        <div className="grid grid-cols-3 overflow-hidden rounded-2xl border border-[#dfe4dd] bg-white">
          {choices.map(c => <button key={c.id} type="button" onClick={() => onPick(c.id)}
            aria-label={c.id === PUTTER ? 'Putter, enter putts' : `${c.name}, stock ${c.stock == null ? 'not set' : `${c.stock} yards`}`} aria-pressed={selected === c.id}
            className={cn('relative min-h-[72px] border-r border-b border-[#e8ece6] px-4 py-3 text-left transition-colors active:bg-[#e4eddf] [&:nth-child(3n)]:border-r-0',
              selected === c.id ? 'bg-[#e8f1e4] text-[#275c3c]' : 'text-[#26392f]')}>
            <span className="block text-[12px] font-medium">{shortName(c.name)}</span>
            {c.id === PUTTER ? <span className="mt-1 block text-[12px] leading-[21px] text-[#657669]">Enter putts</span> : <span className="mt-1 block text-[21px] leading-none font-semibold tabular-nums tracking-tight">{c.stock ?? '—'}<span className="ml-1 text-[10px] font-normal text-[#657669]">yd</span></span>}
            {selected === c.id && <Check className="absolute top-3 right-3 size-3.5" aria-hidden />}
          </button>)}
        </div>
      </div>
    </DrawerContent>
  </Drawer>;
}
