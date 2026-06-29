// _p() — the app's id generator. Random + meaningless; tests strip ids.
export const rid = (): string => Math.random().toString(36).substring(2, 11);
