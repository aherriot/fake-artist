import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ maxWidth: 480 }}>
      <h1>Page not found</h1>
      <p style={{ color: "#888" }}>
        That URL does not exist. Game links look like <code>/game/ABC123</code>.
      </p>
      <Link href="/" style={{ color: "#6af" }}>
        Go home
      </Link>
    </main>
  );
}
