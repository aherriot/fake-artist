import Link from "next/link";
import { clsx } from "clsx";

/**
 * The brand mark, on every page.
 *
 * Set as a gallery plaque: a hairline accent rule, the title in the display
 * serif, and the city in small caps beneath. `full` is the entrance; `compact`
 * is the one-line version for pages where the game itself is the subject.
 */
export function Wordmark({
  size = "compact",
  asLink = true,
  className,
}: {
  size?: "full" | "compact";
  asLink?: boolean;
  className?: string;
}) {
  const inner =
    size === "full" ? (
      <span className="block">
        <span className="block font-display text-5xl leading-[1.02] sm:text-6xl">
          A Fake Artist
        </span>
        <span className="block font-display text-5xl leading-[1.02] sm:text-6xl">
          Goes to New York
        </span>
      </span>
    ) : (
      <span className="flex items-baseline gap-2">
        <span className="font-display text-lg leading-none">A Fake Artist</span>
        <span className="label-caps hidden sm:inline">Goes to New York</span>
      </span>
    );

  const body = (
    <span
      className={clsx(
        "inline-block border-l-2 border-accent-500 pl-3",
        asLink && "transition-opacity hover:opacity-80",
        className,
      )}
    >
      {inner}
    </span>
  );

  return asLink ? (
    <Link href="/" aria-label="A Fake Artist Goes to New York — home">
      {body}
    </Link>
  ) : (
    body
  );
}
