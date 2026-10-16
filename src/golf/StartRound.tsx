// Start a round on your own (from a game, "Start my round" does this with the game attached).
import { Flag } from 'lucide-react';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { courseEntries } from '@/lib/courses';
import { go } from '@/lib/nav';
import { startRound } from '@/lib/store';
import type { Course } from '@/schemas/course';

export function StartRound({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const begin = (course: Course, teeId: string) => {
    startRound(course, teeId);
    onOpenChange(false);
    go('golf/play');
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Start a round</DrawerTitle>
          <DrawerDescription>Pick your tees. Courses with a hole map are listed.</DrawerDescription>
        </DrawerHeader>
        <div className="space-y-4 overflow-y-auto px-5 pb-5">
          {courseEntries.map(({ file, course, error }) => course ? (
            <section key={file} className="space-y-2">
              <div className="flex items-baseline justify-between gap-2 px-1">
                <h3 className="font-semibold">{course.name}</h3>
                <span className="text-xs text-muted-foreground">{course.holes.length} holes · par {course.holes.reduce((s, h) => s + h.par, 0)}</span>
              </div>
              <div className="divide-y overflow-hidden rounded-2xl border bg-card">
                {course.tees.map((t) => {
                  const yards = course.holes.every((h) => h.yards?.[t.id]) ? course.holes.reduce((s, h) => s + (h.yards?.[t.id] ?? 0), 0) : null;
                  return (
                    <button key={t.id} type="button" onClick={() => begin(course, t.id)} className="flex min-h-14 w-full items-center gap-3 px-4 text-left active:bg-accent">
                      <span className="size-5 shrink-0 rounded-full border shadow-inner" style={{ background: t.color }} />
                      <span className="flex-1 font-medium">{t.name}</span>
                      <span className="text-sm text-muted-foreground tabular-nums">
                        {yards ? `${yards} y` : ''}{t.rating ? ` · ${t.rating}/${t.slope}` : ''}
                      </span>
                      <Flag className="size-4 text-primary" />
                    </button>
                  );
                })}
              </div>
            </section>
          ) : (
            <p key={file} className="rounded-xl bg-secondary p-3 text-sm text-secondary-foreground">{file} has a problem: {error}</p>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
