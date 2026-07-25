export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="font-mono text-xs uppercase tracking-widest text-muted">
        Kamel Pulse
      </p>
      <h1
        className="text-2xl font-semibold"
        style={{ fontFamily: "var(--font-inter-tight)" }}
      >
        Corridor liquidity &amp; trust-funnel analytics
      </h1>
      <p className="max-w-md text-sm text-muted">
        Dashboard build in progress. Event pipeline is live.
      </p>
    </main>
  );
}
