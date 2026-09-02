import { Wordmark } from "@/lib/ui/Wordmark";

/**
 * A skeleton rather than the word "Loading".
 *
 * The wordmark lands immediately so the page has an identity while the rest
 * arrives, and the blocks match the shape of what is coming, so nothing jumps
 * when it does.
 */
export default function Loading() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <Wordmark />
      <div className="mt-8 animate-pulse space-y-6">
        <div className="h-20 rounded-sm border border-wall-500 bg-wall-700" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="aspect-square w-full max-w-[34rem] rounded-sm bg-wall-700" />
          <div className="space-y-5">
            <div className="h-40 rounded-sm border border-wall-500 bg-wall-700" />
            <div className="h-56 rounded-sm border border-wall-500 bg-wall-700" />
          </div>
        </div>
      </div>
      <p className="sr-only">Loading…</p>
    </main>
  );
}
