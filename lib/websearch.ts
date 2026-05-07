export interface WebResult {
  id: number;
  title: string;
  url: string;
  content: string;
}

export async function webSearch(query: string): Promise<WebResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: 3,
        search_depth: "basic",
      }),
    });

    if (!res.ok) return [];
    const data = await res.json();
    return (data.results ?? []).slice(0, 3).map((r: any, i: number) => ({
      id: i + 1,
      title: r.title ?? "",
      url: r.url ?? "",
      content: r.content ?? "",
    }));
  } catch {
    return [];
  }
}
