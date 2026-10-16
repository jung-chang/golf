import { NYC_COURSES } from '@/lib/nyc';

const selectClass =
  'h-12 w-full rounded-xl border bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm';

export function HomeCourseSelect({ id, value, onChange }: { id: string; value: string | null; onChange: (code: string | null) => void }) {
  return (
    <select id={id} className={selectClass} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">None</option>
      {NYC_COURSES.map((c) => (
        <option key={c.code} value={c.code}>{`${c.name} (${c.code})`}</option>
      ))}
    </select>
  );
}
