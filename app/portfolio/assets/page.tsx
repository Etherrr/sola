import { redirect } from 'next/navigation';

/** The invented sample portfolio moved to /demo - keep old links working. */
export default function Page() {
  redirect('/demo/assets');
}
