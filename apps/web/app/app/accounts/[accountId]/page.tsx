/**
 * @file apps/web/app/app/accounts/[accountId]/page.tsx
 * @description Redirección por defecto hacia el módulo de Datasets de la cuenta seleccionada.
 */

'use client';
import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AccountIndexPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = use(params);
  const router = useRouter();

  useEffect(() => {
    router.replace(`/app/accounts/${accountId}/datasets`);
  }, [accountId, router]);

  return null;
}
