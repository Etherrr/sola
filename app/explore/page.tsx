import { PageIntro } from '@/components/ui';
import { officialLinks, reviewedOn } from '@/lib/official-links';
export const metadata = { title: 'Explore official resources' };
export default function Explore() {
  return (
    <div className="page-container">
      <PageIntro eyebrow="THE WIDER ECOSYSTEM" title="Explore with intention.">
        <p>
          Official resources for independent research. These links leave Sola Lens and are not
          endorsements.
        </p>
      </PageIntro>
      <p className="notice">
        Third-party sites have their own privacy practices and may offer transactions. Their
        availability here does not establish safety or Sola compatibility. No external scripts are
        loaded by these cards.
      </p>
      <div className="library-grid">
        {officialLinks.map((link) => (
          <a
            className="journey-card"
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            key={link.name}
          >
            <p className="eyebrow">{link.type}</p>
            <h2>{link.name} ↗</h2>
            <p>{new URL(link.url).hostname}</p>
            <span className="card-link">Visit official site · opens new tab</span>
          </a>
        ))}
      </div>
      <p className="fine">
        Source review: {reviewedOn}. Verify the domain and current documentation before acting.
      </p>
    </div>
  );
}
