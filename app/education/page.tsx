import Link from 'next/link';
import { ActionLink } from '@/components/ui';
export const metadata = { title: 'Education' };
export default function EducationHome() {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="status-dot" /> A NEW PERSPECTIVE ON DECENTRALIZED FINANCE
          </p>
          <h1>
            See the whole picture.
            <br />
            <em>Start with clarity.</em>
          </h1>
          <p className="lead">
            Your lens into DeFi. Build your understanding, explore a sample portfolio, and learn to
            recognize the risks — at your own pace.
          </p>
          <div className="actions">
            <ActionLink href="/start">
              Begin your journey <span aria-hidden="true">↗</span>
            </ActionLink>
            <ActionLink href="/demo" secondary>
              Explore the demo <span aria-hidden="true">→</span>
            </ActionLink>
          </div>
          <p className="hero-note">No signup. No wallet required. Always your choice.</p>
        </div>
        <div
          className="lens-visual"
          aria-label="Illustration of a simulated portfolio lens"
          role="img"
        >
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="orbit orbit-three" />
          <div className="lens-core">
            <span className="eyebrow">A CLEARER VIEW</span>
            <span className="lens-title">
              Your DeFi,
              <br />
              in focus.
            </span>
            <span className="lens-line" />
            <span className="fine">UNDERSTAND · OBSERVE · LEARN</span>
          </div>
          <div className="floating-label label-top">
            <span className="violet-dot" /> Knowledge first
          </div>
          <div className="floating-label label-bottom">
            <span className="status-dot" /> SIMULATED · ZERO EXPOSURE
          </div>
        </div>
      </section>
      <section className="journeys section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">ONE LENS. YOUR STARTING POINT.</p>
            <h2>Where would you like to begin?</h2>
          </div>
          <p>
            There’s no single path into DeFi.
            <br />
            Choose the one that feels right.
          </p>
        </div>
        <div className="journey-grid">
          <Link href="/start" className="journey-card">
            <span className="card-number">
              01 <span aria-hidden="true">↗</span>
            </span>
            <span className="card-kicker">BUILD YOUR FOUNDATION</span>
            <h3>I’m new to DeFi</h3>
            <p>
              Start with the basics. Learn about wallets, networks, and staying safe, one idea at a
              time.
            </p>
            <span className="card-link">
              Start learning <span aria-hidden="true">→</span>
            </span>
          </Link>
          <Link href="/connect" className="journey-card">
            <span className="card-number">
              02 <span aria-hidden="true">↗</span>
            </span>
            <span className="card-kicker">GET STRAIGHT TO THE VIEW</span>
            <h3>I know my way around</h3>
            <p>
              Skip the introduction. See what the portfolio experience will offer and explore the
              preview.
            </p>
            <span className="card-link">
              Enter the portal <span aria-hidden="true">→</span>
            </span>
          </Link>
          <Link href="/demo" className="journey-card featured">
            <span className="card-number">
              03 <span aria-hidden="true">↗</span>
            </span>
            <span className="card-kicker">NO WALLET REQUIRED</span>
            <h3>Just exploring</h3>
            <p>
              Discover assets, positions, and risk insights using an entirely simulated sample
              portfolio.
            </p>
            <span className="card-link">
              Open the demo <span aria-hidden="true">→</span>
            </span>
          </Link>
        </div>
      </section>
      <section className="principles section-block">
        <p className="eyebrow">DESIGNED FOR UNDERSTANDING</p>
        <div>
          <h2>
            Confidence begins
            <br />
            with context.
          </h2>
          <p>
            Learn what a number means before deciding what to do with it. Sola Lens brings education
            and observation together, with clear boundaries and visible limitations.
          </p>
          <ul className="check-list">
            <li>Education at every step</li>
            <li>Risks made visible</li>
            <li>Your pace, your path</li>
          </ul>
        </div>
      </section>
    </>
  );
}
