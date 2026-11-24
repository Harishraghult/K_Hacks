import { ClientOnly } from "@/components/ClientOnly";
import { Demo } from "@/components/Demo";
import { ViewProvider } from "@/lib/view";

export default function Page() {
  return (
    <ClientOnly fallback={<div className="flex min-h-screen items-center justify-center text-sm text-zinc-500">Connecting to anchor…</div>}>
      <ViewProvider>
        <Demo />
      </ViewProvider>
    </ClientOnly>
  );
}
