const dailyUrl = "https://tony-journal-heruo.prime-gleam-7947.chatgpt.site/api/daily";

export default async function release() {
  const response = await fetch(dailyUrl, { redirect: "error", signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error("Daily release returned HTTP " + response.status);
  const { day, problems } = await response.json();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Array.isArray(problems)) throw new Error("Invalid daily release response");
  console.info("Daily release", day, problems.length);
  return new Response(null, { status: 204 });
}

// 00:05 in Asia/Shanghai.
export const config = { schedule: "5 16 * * *" };
