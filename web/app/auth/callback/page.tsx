"use client";

import { ConnectBox } from "@phantom/react-sdk";
import { useMounted } from "@/hooks/useMounted";

export default function PhantomAuthCallbackPage() {
  const mounted = useMounted();

  return (
    <main className="min-h-[70vh] flex items-center justify-center px-4 py-16">
      {mounted ? <ConnectBox maxWidth={360} /> : null}
    </main>
  );
}
