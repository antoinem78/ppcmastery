// /onboarding with no client id — there's nothing to show. Real onboarding
// happens at /onboarding/[id] via the link an admin sends.

export default function OnboardingIndexPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-8">
      <div className="max-w-md rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <div className="text-lg tracking-tight">
          <span className="font-semibold text-[#0B1F3A]">PPC</span>{" "}
          <span className="font-light text-zinc-500">mastery</span>
        </div>
        <h1 className="mt-4 text-xl font-semibold text-zinc-900">
          Onboarding link needed
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          Please use the personalised onboarding link we sent you. If you don&rsquo;t
          have one, contact your PPC Mastery representative.
        </p>
      </div>
    </div>
  );
}
