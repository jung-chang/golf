import { useState } from 'react';
import { go } from '../lib/nav';
import { courseEntries } from '../lib/courses';
import { fmtToPar, playedHoles, toPar } from '../lib/round';
import { getState, saveRound, setActive, startRound, useStore } from '../lib/store';
import type { Course } from '../schemas/course';

export function Courses() {
  const active = useStore((s) => (s.activeId ? s.rounds[s.activeId] : null));
  const [open, setOpen] = useState<string | null>(null);

  function start(course: Course, teeId: string) {
    if (getState().activeId && !confirm('You have a round in progress. Start a new one anyway?')) return;
    startRound(course, teeId);
    go('golf/play');
  }

  function end() {
    if (!active || !confirm('End this round? It stays in your history.')) return;
    saveRound({ ...active, done: true, updatedAt: new Date().toISOString() }, { push: true });
    setActive(null);
  }

  return (
    <div className="page">
      {active && (
        <div className="card resume">
          <div>
            <strong>{active.courseName}</strong>
            <div className="muted">
              {active.teeName} · {playedHoles(active).length ? `${fmtToPar(toPar(active))} thru ${playedHoles(active).length}` : 'not started'}
            </div>
          </div>
          <div className="row">
            <button className="primary" onClick={() => go('golf/play')}>Resume</button>
            <button onClick={end}>End</button>
          </div>
        </div>
      )}
      <h2>Courses</h2>
      <div className="list">
        {courseEntries.map(({ file, course, error }) =>
          course ? (
            <div className="card" key={file}>
              <button className="link" onClick={() => setOpen(open === course.id ? null : course.id)}>
                <strong>{course.name}</strong>
                <div className="muted">
                  {course.locality ? `${course.locality} · ` : ''}{course.holes.length} holes · par {course.holes.reduce((s, h) => s + h.par, 0)}
                </div>
              </button>
              {open === course.id && (
                <div className="tees">
                  <div className="muted">Pick tees to start a round</div>
                  {course.tees.map((t) => (
                    <button key={t.id} className="tee" onClick={() => start(course, t.id)}>
                      <span className="swatch" style={{ background: t.color }} />
                      {t.name}
                      {course.holes.every((h) => h.yards?.[t.id]) && ` · ${course.holes.reduce((s, h) => s + (h.yards?.[t.id] ?? 0), 0)} y`}
                      {t.rating && <small> {t.rating}/{t.slope}</small>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="card error" key={file}><strong>{file}</strong><div className="muted">Invalid course file: {error}</div></div>
          ),
        )}
      </div>
    </div>
  );
}
