export function extractToken(): string | null {
  const raw = localStorage.getItem("auth");
  if (!raw) return null;

  try {
    const session = JSON.parse(raw);
    const token = session?.token?.access_token;
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}
