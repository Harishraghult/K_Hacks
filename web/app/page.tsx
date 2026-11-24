import { ClientOnly } from "@/components/ClientOnly";
import { Demo } from "@/components/Demo";

export default function Page() {
  return (
    <ClientOnly fallback={<div className="flex min-h-screen items-center justify-center text-sm text-zinc-500">Connecting to anchor…</div>}>
      <Demo />
    </ClientOnly>
  );
}
