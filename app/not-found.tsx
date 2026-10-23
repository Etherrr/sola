import { ActionLink } from '@/components/ui';
export default function NotFound() {
  return (
    <div className="page-container narrow">
      <p className="eyebrow">404 / OUT OF FOCUS</p>
      <h1>That page isn’t here.</h1>
      <p>Find your way back to the learning preview.</p>
      <ActionLink href="/">Return home →</ActionLink>
    </div>
  );
}
