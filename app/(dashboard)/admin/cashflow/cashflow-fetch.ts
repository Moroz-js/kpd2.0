export async function fetchCashflowJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? `Не удалось загрузить данные (${response.status})`);
  }
  return response.json();
}
