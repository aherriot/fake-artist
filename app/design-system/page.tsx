"use client";

import { useState } from "react";
import {
  Button,
  Field,
  Frame,
  PlayerChip,
  Pill,
  Plaque,
  WallLabel,
  penVar,
} from "@/lib/ui/primitives";
import { Accordion, Choice, Modal, Select, Tabs, Toggle } from "@/lib/ui/controls";

const PENS = Array.from({ length: 10 }, (_, i) => i + 1);
const WALLS = ["950", "900", "800", "700", "600", "500", "400"];
const LABELS = ["100", "300", "500", "700"];
const ACCENTS = ["400", "500", "600", "700"];

export default function DesignSystem() {
  const [modal, setModal] = useState(false);
  const [pack, setPack] = useState("standard");
  const [ready, setReady] = useState(false);
  const [vote, setVote] = useState("p3");

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <header className="mb-16">
        <p className="label-caps">Design system</p>
        <h1 className="mt-2 font-display text-5xl leading-none">Gallery at Night</h1>
        <p className="mt-4 max-w-xl text-label-300">
          A darkened exhibition space with the artwork lit. The chrome is gallery signage;
          the drawing is the only thing that should hold your eye.
        </p>
        <p className="mt-3 max-w-xl text-sm text-label-500">
          The governing constraint: up to ten saturated pen colours share the screen, so the
          interface has to recede. Everything here is warm neutral except one accent.
        </p>
      </header>

      <Section n="01" title="The wall">
        <p className="mb-4 text-sm text-label-500">
          Warm charcoal, never pure black — real galleries are warm. Seven steps carry every
          surface, border, and disabled state.
        </p>
        <div className="flex flex-wrap gap-2">
          {WALLS.map((w) => (
            <Swatch key={w} name={`wall-${w}`} color={`var(--color-wall-${w})`} />
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          {LABELS.map((l) => (
            <Swatch key={l} name={`label-${l}`} color={`var(--color-label-${l})`} dark />
          ))}
        </div>
      </Section>

      <Section n="02" title="The accent">
        <p className="mb-4 text-sm text-label-500">
          The Oink hot pink — a loud anachronism in a sober room. Reserved for the single most
          important action on a screen, and used nowhere else.
        </p>
        <div className="flex flex-wrap gap-2">
          {ACCENTS.map((a) => (
            <Swatch key={a} name={`accent-${a}`} color={`var(--color-accent-${a})`} dark />
          ))}
        </div>
      </Section>

      <Section n="03" title="Pens">
        <p className="mb-4 max-w-2xl text-sm text-label-500">
          Seats 1–8 start from Okabe–Ito, the colour-universal categorical standard. Four hues
          are darkened here and seat 7 is replaced outright: Okabe–Ito was authored for chart
          fills, and several of its colours are too light to read as a 3px stroke on cream.
          Every pen clears 3.2:1 against the paper. Seats 9–10 sit past the point where any
          palette stays reliably distinguishable — which is exactly why attribution never rests
          on colour alone, and why every stroke also carries its seat number.
        </p>
        <Frame className="p-6">
          <div className="flex flex-wrap gap-4">
            {PENS.map((s) => (
              <div key={s} className="text-center">
                <div className="size-12 rounded-sm" style={{ background: penVar(s) }} />
                <p className="mt-1.5 font-mono text-[11px] text-ink/60">
                  {s}
                  {s > 8 && <span className="text-ink/40"> ext</span>}
                </p>
              </div>
            ))}
          </div>
          <svg viewBox="0 0 400 60" className="mt-6 w-full" aria-label="Pen strokes on paper">
            {PENS.map((s) => (
              <path
                key={s}
                d={`M ${8 + (s - 1) * 40} 50 q 12 -${16 + s * 3} 26 -6`}
                stroke={penVar(s)}
                strokeWidth="3"
                strokeLinecap="round"
                fill="none"
              />
            ))}
          </svg>
        </Frame>
      </Section>

      <Section n="04" title="Type">
        <div className="space-y-6">
          <div>
            <p className="label-caps mb-2">Display · Instrument Serif</p>
            <p className="font-display text-4xl">Untitled (Something red)</p>
          </div>
          <div>
            <p className="label-caps mb-2">Body · Inter</p>
            <p className="max-w-lg text-label-300">
              Draw one continuous line. Prove you know the subject without giving it away to
              the one player who does not.
            </p>
          </div>
          <div>
            <p className="label-caps mb-2">Catalogue · IBM Plex Mono</p>
            <p className="catalogue-no">Cat. no. 6P8942 · seat 04 · pass 2 of 2</p>
          </div>
        </div>
      </Section>

      <Section n="05" title="Wall label">
        <p className="mb-4 text-sm text-label-500">
          The signature element. Title, medium, catalogue number — and status, since
          <em> attribution</em> is both the museum term and this game&apos;s mechanic.
        </p>
        <WallLabel
          title="Untitled (Something red)"
          medium="Six hands, ink on paper, 2026"
          catalogue="6P8942"
          status={<Pill tone="accent">Attribution pending</Pill>}
        />
      </Section>

      <Section n="06" title="Artwork frame">
        <p className="mb-4 text-sm text-label-500">
          The only light source in the room. Warm paper, a hairline edge, and a soft bloom
          that reads as gallery lighting rather than a CSS drop shadow.
        </p>
        <Frame className="grid h-56 place-items-center">
          <svg viewBox="0 0 200 100" className="h-32" aria-label="Example drawing">
            <path d="M 60 70 q 20 -46 40 -10" stroke={penVar(1)} strokeWidth="3" fill="none" strokeLinecap="round" />
            <path d="M 95 62 q 26 12 44 -18" stroke={penVar(2)} strokeWidth="3" fill="none" strokeLinecap="round" />
            <path d="M 70 40 q 30 -18 52 6" stroke={penVar(3)} strokeWidth="3" fill="none" strokeLinecap="round" />
          </svg>
        </Frame>
      </Section>

      <Section n="07" title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Submit line</Button>
          <Button variant="secondary">Undo</Button>
          <Button variant="ghost">Skip player</Button>
          <Button variant="danger">Leave match</Button>
          <Button variant="primary" disabled>Waiting…</Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button size="sm" variant="primary">Cast vote</Button>
          <Button size="sm" variant="secondary">Copy code</Button>
        </div>
      </Section>

      <Section n="08" title="Players">
        <Plaque className="max-w-sm space-y-2.5">
          <p className="label-caps mb-3">Six hands</p>
          <PlayerChip seat={1} name="Alice" host />
          <PlayerChip seat={2} name="Bob" you />
          <PlayerChip seat={3} name="Cara" />
          <PlayerChip seat={4} name="Dev" online={false} />
          <PlayerChip seat={9} name="Ekow" />
          <PlayerChip seat={10} name="Fran" />
        </Plaque>
        <p className="mt-3 max-w-lg text-xs text-label-500">
          The seat number sits inside the colour chip, never instead of it — so seats 9 and 10
          stay identifiable even where their hues are hard to separate.
        </p>
      </Section>

      <Section n="09" title="Status">
        <div className="flex flex-wrap gap-2">
          <Pill>Lobby</Pill>
          <Pill tone="accent">Your turn</Pill>
          <Pill tone="success">Attributed</Pill>
          <Pill tone="warning">Awaiting line</Pill>
          <Pill tone="danger">Forgery</Pill>
        </div>
      </Section>

      <Section n="10" title="Form controls">
        <div className="grid gap-6 sm:grid-cols-2">
          <Field label="Name" placeholder="e.g. Hopper" />
          <Field label="Room code" placeholder="6P8942" mono maxLength={6} hint="Six characters, never O I 0 or 1." />
          <Select
            label="Word pack"
            value={pack}
            onChange={setPack}
            options={[
              { value: "standard", label: "Standard" },
              { value: "tricky", label: "Tricky" },
            ]}
          />
          <div className="self-end">
            <Toggle
              checked={ready}
              onChange={setReady}
              label="Show seat numbers"
              description="Numbers sit on every line, since colour cannot carry ten players."
            />
          </div>
        </div>
      </Section>

      <Section n="11" title="Voting">
        <div className="max-w-sm">
          <Choice
            label="Who is the fake artist?"
            value={vote}
            onChange={setVote}
            options={[
              { value: "p1", label: "Alice", description: "Seat 1 · drew first" },
              { value: "p3", label: "Cara", description: "Seat 3" },
              { value: "p4", label: "Dev", description: "Seat 4 · was skipped" },
            ]}
          />
        </div>
      </Section>

      <Section n="12" title="Disclosure and tabs">
        <Tabs
          tabs={[
            { label: "Rules", content: "Draw one continuous line on your turn. Two passes." },
            { label: "Scoring", content: "One point to each winner of the round." },
            { label: "History", content: "Round 1 — the fake artist escaped." },
          ]}
        />
        <div className="mt-8">
          <Accordion
            items={[
              { q: "What if someone goes away?", a: "The game pauses and the host can skip them." },
              { q: "Can I join a match in progress?", a: "Yes, at any round boundary." },
            ]}
          />
        </div>
      </Section>

      <Section n="13" title="Overlay">
        <Button variant="secondary" onClick={() => setModal(true)}>
          Open the reveal
        </Button>
        <Modal
          open={modal}
          onClose={() => setModal(false)}
          title="Attribution"
          footer={
            <>
              <Button variant="ghost" onClick={() => setModal(false)}>Close</Button>
              <Button variant="primary" onClick={() => setModal(false)}>Next round</Button>
            </>
          }
        >
          <p>
            The subject was <strong className="text-label-100">Tomato</strong>. The fake artist
            was <strong className="text-label-100">Cara</strong>, and the room found her.
          </p>
        </Modal>
        <p className="mt-3 text-xs text-label-500">
          The reveal is the one moment that earns animation. Everything else stays quiet.
        </p>
      </Section>
    </main>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-16 border-t border-wall-500 pt-8">
      <div className="mb-5 flex items-baseline gap-3">
        <span className="catalogue-no">{n}</span>
        <h2 className="font-display text-2xl">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Swatch({ name, color, dark = false }: { name: string; color: string; dark?: boolean }) {
  return (
    <div className="w-28">
      <div
        className="h-14 rounded-sm border border-wall-500"
        style={{ background: color }}
      />
      <p className={`mt-1.5 font-mono text-[11px] ${dark ? "text-label-300" : "text-label-500"}`}>
        {name}
      </p>
    </div>
  );
}
