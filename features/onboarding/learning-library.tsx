'use client';
import Link from 'next/link';
import { lessons, type LessonSection } from '@/content/lessons';
import { useProgress } from './progress-provider';

// Plan §8 learning shell: the library groups its modules by the plan's five sections, in
// this fixed order; practice exercises stay last and labeled as simulations. Lesson copy,
// order within a section, progress persistence and guest access are unchanged.
export const SECTION_ORDER: LessonSection[] = [
  'Start Here',
  'Fundamentals',
  'Wallets & Networks',
  'DeFi Strategies',
  'Risk & Security',
];

export function LearningLibrary() {
  const { completed, enabled, notice } = useProgress();
  return (
    <>
      <div className="learning-progress">
        <label htmlFor="course-progress">
          {completed.length} of {lessons.length} modules completed
        </label>
        <progress id="course-progress" value={completed.length} max={lessons.length} />
        <p className="fine">
          {enabled
            ? 'Progress saved on this browser.'
            : 'Progress lasts for this visit. Optional saving is in Settings.'}
        </p>
        <p role="status">{notice}</p>
        <p className="fine">
          <Link href="/account">← Back to the portfolio</Link>
        </p>
      </div>
      {SECTION_ORDER.map((section) => {
        const items = lessons.filter((l) => l.section === section);
        if (items.length === 0) return null;
        return (
          <section key={section} aria-labelledby={`sec-${section.replace(/[^a-z]/gi, '')}`}>
            <h2 id={`sec-${section.replace(/[^a-z]/gi, '')}`} className="eyebrow">
              {section}
            </h2>
            <div className="library-grid">
              {items.map((lesson) => (
                <Link className="journey-card" href={lesson.path} key={lesson.id}>
                  <span className="eyebrow">{lesson.eyebrow}</span>
                  <h2>{lesson.title}</h2>
                  <p>{lesson.summary}</p>
                  <span className="card-link">
                    {completed.includes(lesson.id) ? 'Completed · Review lesson' : 'Explore lesson'}{' '}
                    →
                  </span>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
      <section aria-labelledby="sec-practice">
        <h2 id="sec-practice" className="eyebrow">
          Practice exercises
        </h2>
        <div className="library-grid">
          <Link className="journey-card" href="/learn/network-journey">
            <span className="eyebrow">INTERACTIVE · SIMULATED</span>
            <h2>An Ethereum transfer, step by step</h2>
            <p>
              Follow one pretend ETH transfer from approval to finality. Pause, step or scrub.
            </p>
            <span className="card-link">Try the scene →</span>
          </Link>
          <Link className="journey-card" href="/learn/security-lab">
            <span className="eyebrow">INTERACTIVE · SIMULATED</span>
            <h2>Security decision lab</h2>
            <p>
              Four made-up prompts: connect, recovery phrase, spending approval and a look-alike
              link. See the consequence of each choice.
            </p>
            <span className="card-link">Try the lab →</span>
          </Link>
        </div>
      </section>
    </>
  );
}
