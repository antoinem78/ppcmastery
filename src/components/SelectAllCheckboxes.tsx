"use client";

// Select/unselect-all for the MCC import list. Toggles every enabled
// account_ids checkbox in the page (already-imported ones are disabled and left
// untouched). The checkboxes are uncontrolled, so we set .checked directly.
export function SelectAllCheckboxes() {
  const setAll = (checked: boolean) => {
    document
      .querySelectorAll<HTMLInputElement>('input[name="account_ids"]:not(:disabled)')
      .forEach((el) => {
        el.checked = checked;
      });
  };
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => setAll(true)}
        className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
      >
        Select all
      </button>
      <button
        type="button"
        onClick={() => setAll(false)}
        className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
      >
        Unselect all
      </button>
    </div>
  );
}
