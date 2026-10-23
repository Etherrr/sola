'use client';
import Link from 'next/link';
import { lessons } from '@/content/lessons';
import { useProgress } from './progress-provider';
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
      </div>
      <div className="library-grid">
        {lessons.map((lesson) => (
          <Link className="journey-card" href={lesson.path} key={lesson.id}>
            <span className="eyebrow">{lesson.eyebrow}</span>
            <h2>{lesson.title}</h2>
            <p>{lesson.summary}</p>
            <span className="card-link">
              {completed.includes(lesson.id) ? 'Completed · Review lesson' : 'Explore lesson'} →
            </span>
          </Link>
        ))}
        <Link className="journey-card" href="/learn/network-journey">
          <span className="eyebrow">INTERACTIVE · SIMULATED</span>
          <h2>An Ethereum transfer, step by step</h2>
          <p>Follow one pretend ETH transfer from approval to finality. Pause, step or scrub.</p>
          <span className="card-link">Try the scene →</span>
        </Link>
      </div>
    </>
  );
}
