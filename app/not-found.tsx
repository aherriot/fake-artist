import Link from "next/link";
import { Wordmark } from "@/lib/ui/Wordmark";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <Wordmark />
      <h1 className="mt-10 font-display text-4xl">Nothing hangs here</h1>
      <p className="mt-3 text-label-300">
        That address does not exist. Game links look like{" "}
        <code className="catalogue-no">/game/ABC234</code>.
      </p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-sm bg-accent-500 px-4 py-2 text-sm font-medium text-wall-950 hover:bg-accent-400"
      >
        Go home
      </Link>
    </main>
  );
}
