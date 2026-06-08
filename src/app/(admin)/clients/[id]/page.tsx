// Single client record + activity log (stub).

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="p-10">
      <h1 className="text-2xl font-semibold text-zinc-900">Client</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Record + activity log for client{" "}
        <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">{id}</code>.
        Built out in Phase 1.
      </p>
    </div>
  );
}
