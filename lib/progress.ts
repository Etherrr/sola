import { lessons } from '../content/lessons';
export const PROGRESS_KEY = 'sola-lens.progress.v1';
export function parseProgress(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return [
      ...new Set(
        value.filter(
          (id): id is string =>
            typeof id === 'string' && lessons.some((lesson) => lesson.id === id),
        ),
      ),
    ];
  } catch {
    return [];
  }
}
