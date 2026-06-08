// Public, link-driven client onboarding wizard (Phase 1).
// Intentionally a placeholder for now — Phase 0 only stands up the route.

export default function OnboardingPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-8">
      <div className="max-w-md rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <div className="text-lg tracking-tight">
          <span className="font-semibold text-[#0B1F3A]">PPC</span>{" "}
          <span className="font-light text-zinc-500">mastery</span>
        </div>
        <h1 className="mt-4 text-xl font-semibold text-zinc-900">
          Onboarding
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          The onboarding wizard (questionnaire → contract → payment) is built in
          Phase 1.
        </p>
      </div>
    </div>
  );
}
