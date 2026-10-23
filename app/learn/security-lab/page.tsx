import Link from 'next/link';
import { PageIntro } from '@/components/ui';
import { SecurityLab } from '@/features/education/security-lab';
export const metadata = { title: 'Security decision lab' };
export default function Page() {
  return (
    <div className="page-container">
      <PageIntro eyebrow="LEARN BY DOING" title="Spot the risky prompt before it costs you.">
        <p>
          Four short, made-up situations. Pick what you would do, then see what would happen. You
          never type a secret here, and there is nothing to connect.
        </p>
      </PageIntro>
      <SecurityLab />
      <p className="notice">
        <Link href="/learn">Back to the learning library</Link>
      </p>
    </div>
  );
}
