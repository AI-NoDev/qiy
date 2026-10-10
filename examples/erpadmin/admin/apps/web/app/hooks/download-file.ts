export async function downloadFile(key: string, fetcher: typeof fetch = fetch): Promise<void> {
  const token = window.localStorage.getItem("qiy.access_token");
  const headers: HeadersInit = token ? { Authorization: "Bearer " + token } : {};
  const endpoint = "/api/v1/files?key=" + encodeURIComponent(key);
  const signed = await fetcher("/api/v1/files/signed?key=" + encodeURIComponent(key), { headers });
  if (!signed.ok) throw new Error("Download failed: " + signed.status);
  const { url } = await signed.json() as { url: string | null };
  if (url) {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.click();
    return;
  }
  const response = await fetcher(endpoint, { headers });
  if (!response.ok) throw new Error("Download failed: " + response.status);
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = key.split("/").pop() ?? "download";
  link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
