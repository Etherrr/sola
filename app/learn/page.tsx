import { PageIntro } from '@/components/ui';
import { LearningLibrary } from '@/features/onboarding/learning-library';
export const metadata = { title: 'Learning library' };
export default function Learn() {
  return (
    <div className="page-container">
      <PageIntro eyebrow="THE LEARNING LIBRARY" title="A little context goes a long way.">
        <p>
          Six foundations for exploring DeFi with greater understanding. Start anywhere; return
          whenever you need.
        </p>
      </PageIntro>
      <LearningLibrary />
    </div>
  );
}
