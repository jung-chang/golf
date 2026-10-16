// Isolated public-course fixture: no account, storage, or device GPS access.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import { HoleReview } from '../../src/play/HoleReview';
import { defaultBag } from '../../src/lib/clubs';
import { getCourse } from '../../src/lib/courses';
import { bearing, offset, M_TO_YD } from '../../src/lib/geo';
import * as R from '../../src/lib/round';

const course = getCourse('clearview-park')!;
const hole = course.holes[0], pin = hole.green.center, tee = hole.path![0];
const direction = bearing(pin, tee);
let round = R.markShot(R.newRound(course, course.tees[0].id), 'dr', tee, 2);
round = R.markShot(round, '7i', offset(pin, direction, 150 / M_TO_YD), 2);
round = R.markShot(round, 'sw', offset(pin, direction, 22 / M_TO_YD), 2);
round = R.putt(round, offset(pin, direction, 5 / M_TO_YD), 2);
round = R.putt(round, offset(pin, direction, 1 / M_TO_YD), 2);
round = R.holeDone(round, pin);
function Preview() {
  const [open, setOpen] = useState(true);
  return <main className="min-h-dvh bg-background p-6 text-foreground">
    <p className="text-sm text-muted-foreground">Local preview · synthetic shots · no account data</p>
    <h1 className="mt-3 text-xl font-bold">Hole 1 · Par 4 · Score 5</h1>
    <button className="mt-4 min-h-11 rounded-xl bg-primary px-4 text-primary-foreground" onClick={() => setOpen(true)}>Review hole 1</button>
    {open && <HoleReview hole={hole} state={round.holes[hole.number]} bag={defaultBag()} onClose={() => setOpen(false)} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
