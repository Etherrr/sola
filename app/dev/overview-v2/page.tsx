import { PageIntro } from '@/components/ui';
export const metadata = { title: 'Overview v2 (preview build)' };

/**
 * First v0.2 unified Overview screen, in its honest EMPTY state: no saved
 * addresses and no recorded history yet. Every number area says WHY it is
 * empty instead of inventing figures. This screen is the layout the reviewed
 * read model (subtotals, per-source observation times, complete-run labels)
 * will fill once the secured read routes wire.
 */
export default function OverviewV2() {
  return (
    <div className="page-container">
      <PageIntro eyebrow="PORTFOLIO V2 · PREVIEW BUILD" title="Overview.">
        <p>
          One normalized view of spot balances, DeFi positions and debt - every figure traced to a
          source and an observation time, every unknown labeled unknown.
        </p>
      </PageIntro>

      <section className="panel">
        <h2>Priced subtotal</h2>
        <p>
          <em>Nothing to show yet - this screen is not connected to live data.</em> The secured
          read routes are being enabled in stages. Connect your addresses to load positions; when
          connected, this area shows a subtotal over recognized, freshly priced positions only -
          never a claim about your whole portfolio.
        </p>
      </section>

      <section className="panel">
        <h2>What changed</h2>
        <p>
          <em>History begins after your first recorded observation.</em> Deltas compare the latest
          complete observation against the prior complete one; an incomplete observation is never
          treated as &quot;zero&quot;.
        </p>
      </section>

      <section className="panel">
        <h2>DeFi positions</h2>
        <p>
          <em>Connect your addresses to load positions.</em> Supplied and borrowed amounts are
          shown per protocol with signed netting; debt is always visible and never merged into
          asset balances.
        </p>
      </section>

      <section className="panel">
        <h2>Risk notes</h2>
        <p>
          <em>Nothing to measure yet.</em> Concentration figures cover recognized positions only and
          are marked partial whenever coverage is incomplete. No yields, returns or P&amp;L are
          shown or implied - &quot;Not yet calculated&quot; is the answer.
        </p>
      </section>

      <section className="panel">
        <h2>Status</h2>
        <p>
          Preview build: the live read routes that fill this screen are being enabled in stages,
          behind review. Until then every section shows its honest empty state.
        </p>
      </section>
    </div>
  );
}
