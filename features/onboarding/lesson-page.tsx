import Link from 'next/link';
import { getLesson, lessons } from '@/content/lessons';
import { PageIntro, ActionLink } from '@/components/ui';
import { Quiz } from './quiz';
import { WalletGuide } from './wallet-guide';
import { SwapWalkthrough } from './swap-walkthrough';
export function LessonPage({ id }: { id: string }) {
  const lesson = getLesson(id);
  const index = lessons.indexOf(lesson);
  const next = lessons[index + 1];
  return (
    <div className="page-container lesson-layout">
      <aside className="lesson-sidebar">
        <p className="eyebrow">THE FOUNDATION</p>
        <nav aria-label="Learning modules">
          {lessons.map((item, number) => (
            <Link key={item.id} href={item.path} aria-current={item.id === id ? 'step' : undefined}>
              <span>0{number + 1}</span>
              {item.id === 'basics'
                ? 'Blockchain basics'
                : item.id === 'defi'
                  ? 'Swap walkthrough'
                  : item.title.replace('.', '')}
            </Link>
          ))}
        </nav>
        <p className="fine">
          No wallet or funds needed.
          <br />
          Your pace. Your choice.
        </p>
      </aside>
      <article>
        <div className="onboarding-controls">
          <Link href={index === 0 ? '/' : lessons[index - 1].path}>← Back</Link>
          <Link href={next?.path ?? '/portfolio'}>Skip this lesson →</Link>
          <Link href="/">Exit</Link>
        </div>
        <PageIntro eyebrow={lesson.eyebrow} title={lesson.title}>
          <p>{lesson.summary}</p>
        </PageIntro>
        <div className="lesson-sections">
          {lesson.sections.map((section, number) => (
            <section key={section.title}>
              <span className="section-index">0{number + 1}</span>
              <div>
                <h2>{section.title}</h2>
                <p>{section.body}</p>
              </div>
            </section>
          ))}
        </div>
        {id === 'wallets' && <WalletGuide />}
        {id === 'defi' && <SwapWalkthrough />}
        {id === 'addresses' && (
          <p className="notice">
            <Link href="/learn/networks">Explore Ethereum and Solana network concepts →</Link>
          </p>
        )}
        <Quiz lesson={lesson} />
        <div className="lesson-end">
          <p className="muted">Move ahead whenever you’re ready.</p>
          <ActionLink href={next?.path ?? '/portfolio'}>
            {next ? 'Continue learning →' : 'Explore the simulated portfolio →'}
          </ActionLink>
        </div>
      </article>
    </div>
  );
}
