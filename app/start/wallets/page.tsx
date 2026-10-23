import { LessonPage } from '@/features/onboarding/lesson-page';
import { getLesson } from '@/content/lessons';
export const metadata = { title: getLesson('wallets').title };
export default function Page() {
  return <LessonPage id="wallets" />;
}
