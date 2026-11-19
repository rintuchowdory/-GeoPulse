export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  try {
    const raw = sessionStorage.getItem("manus-cookie");
    const prefix = "manus-cookie=";
    const token = raw
      ?.split(";")
      .map(x => x.trim())
      .find(x => x.startsWith(prefix))
      ?.slice(prefix.length);
    if (token && !headers.has("Authorization"))
      headers.set("Authorization", `Bearer ${token}`);
  } catch {
    /* sessionStorage can be unavailable in privacy modes */
  }
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });
  let data: any = {};
  try {
    data = await response.json();
  } catch {
    /* handled below */
  }
  if (!response.ok)
    throw new ApiError(
      data.error ?? `Request fehlgeschlagen (${response.status})`,
      response.status
    );
  return data as T;
}
export const jsonBody = (data: unknown) => JSON.stringify(data);
export const absoluteLink = (path: string) =>
  `${window.location.origin}${path}`;
