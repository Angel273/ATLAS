/**
 * @file apps/web/app/portal/page.tsx
 * @description Redirección canónica de /portal hacia /portal/accounts.
 */

import { redirect } from 'next/navigation';

export default function PortalPage() {
  redirect('/portal/accounts');
}
