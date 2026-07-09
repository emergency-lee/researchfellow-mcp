export default function Home() {
  return (
    <main
      style={{
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        maxWidth: 640,
        margin: "12vh auto",
        padding: "0 24px",
        lineHeight: 1.7,
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em" }}>
        ResearchFellow MCP
      </h1>
      <p style={{ color: "#555" }}>
        Paid remote tier — Brain / Watch / Integrity. This is a machine endpoint.
      </p>
      <ul style={{ color: "#333", paddingLeft: 18 }}>
        <li>
          MCP endpoint (Streamable HTTP): <code>/api/mcp</code>
        </li>
        <li>
          Docs: <code>researchfellow.vercel.app</code>
        </li>
      </ul>
    </main>
  );
}
