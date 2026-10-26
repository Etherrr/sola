import { Suspense } from 'react';
import { PageIntro } from '@/components/ui';
import { ClaimDevSurface } from '@/features/claim/dev-preview';
export const metadata = { title: 'Claim panel (preview build)' };

/** LOCAL DEV SURFACE ONLY: the claim panel (?case=...) and the /account claim
 *  section (?surface=section&case=...&discovery=on|off|error) rendered against
 *  synthetic fixtures. Not wired to real endpoints from this page. */
export default function ClaimDevPreview() {
  return (
    <div className="page-container narrow">
      <PageIntro eyebrow="PREVIEW BUILD - SYNTHETIC FIXTURES" title="Move saved addresses">
        <p>Fixture data only. No real account, no real addresses, no network calls.</p>
      </PageIntro>
      <Suspense>
        <ClaimDevSurface />
      </Suspense>
    </div>
  );
}
