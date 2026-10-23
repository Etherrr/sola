'use client';
import { useState } from 'react';
import type { Lesson } from '@/content/lessons';
import { useProgress } from './progress-provider';
export function Quiz({ lesson }: { lesson: Lesson }) {
  const [answer, setAnswer] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const { complete } = useProgress();
  const correct = answer === lesson.correct;
  return (
    <section className="quiz panel" aria-label="Knowledge check">
      <p className="eyebrow">A MOMENT TO REFLECT</p>
      <h2>{lesson.question}</h2>
      <fieldset>
        <legend className="sr-only">Choose one answer</legend>
        {lesson.answers.map((text, index) => (
          <label className="answer" key={text}>
            <input
              type="radio"
              name={`quiz-${lesson.id}`}
              checked={answer === index}
              onChange={() => {
                setAnswer(index);
                setChecked(false);
              }}
            />
            {text}
          </label>
        ))}
      </fieldset>
      <button
        className="button primary"
        disabled={answer === null}
        onClick={() => {
          setChecked(true);
          if (correct) complete(lesson.id);
        }}
      >
        Check answer
      </button>
      <div aria-live="polite">
        {checked && (
          <p className={correct ? 'feedback success' : 'feedback'}>
            {correct ? 'That’s right. ' : 'Try again. '}
            {lesson.explanation}
          </p>
        )}
      </div>
    </section>
  );
}
