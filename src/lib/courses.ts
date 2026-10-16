// Every /courses/*.json file is a course. Drop a file in, rebuild, done.
import { Course } from '../schemas/course';

const files = import.meta.glob<unknown>('/courses/*.json', { eager: true, import: 'default' });

export type CourseEntry = { file: string; course?: Course; error?: string };

export const courseEntries: CourseEntry[] = Object.entries(files)
  .map(([file, data]) => {
    const r = Course.safeParse(data);
    return r.success
      ? { file, course: r.data }
      : { file, error: r.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  })
  .sort((a, b) => (a.course?.name ?? a.file).localeCompare(b.course?.name ?? b.file));

export const getCourse = (id: string) => courseEntries.find((e) => e.course?.id === id)?.course;
