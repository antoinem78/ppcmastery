"use client";

// A submit button that asks for confirmation before letting the form submit.
// Used for destructive admin actions (e.g. deleting a client).
export function ConfirmSubmitButton({
  message,
  children,
  className,
}: {
  message: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
