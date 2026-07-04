import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ResearchFellow MCP",
  description: "ResearchFellow paid remote MCP tier — endpoint at /api/mcp",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
