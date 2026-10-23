import { PageIntro, ActionLink, SimulatedNotice } from '@/components/ui';
export const metadata = { title: 'Experienced user portal' };
export default function Connect() {
  return (
    <div className="page-container narrow">
      <SimulatedNotice />
      <PageIntro eyebrow="THE EXPERIENCED PATH" title="Straight to the perspective.">
        <p>
          Skip the introduction and explore the sample portfolio. Experience does not depend on
          connection status.
        </p>
      </PageIntro>
      <div className="panel">
        <h2>Public-address lookup</h2>
        <p>
          Planned for a later release. This preview does not accept addresses or query a blockchain.
          A future address view would observe public activity without proving ownership.
        </p>
        <span className="badge">NOT AVAILABLE IN v0.1</span>
      </div>
      <div className="panel">
        <h2>Wallet account discovery</h2>
        <p>
          Planned for a later release, subject to compatibility and security review. Discovery and
          signing are different permissions. Sola Lens does not request either in this preview.
        </p>
        <span className="badge">NOT AVAILABLE IN v0.1</span>
      </div>
      <div className="actions">
        <ActionLink href="/portfolio">Open simulated portfolio →</ActionLink>
        <ActionLink href="/learn" secondary>
          Browse the lessons
        </ActionLink>
      </div>
    </div>
  );
}
