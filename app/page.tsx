"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { Button, Field, Plaque } from "@/lib/ui/primitives";
import { Wordmark } from "@/lib/ui/Wordmark";

/** The join-code alphabet: no O, I, 0 or 1, so codes survive being read aloud. */
const CODE_ALPHABET = /[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g;
const CODE_LENGTH = 6;

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<null | "create" | "join">(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  /**
   * Validate on submit rather than disabling the buttons.
   *
   * A disabled button explains nothing: you cannot tell which field is at
   * fault, and assistive tech is told nothing at all. Letting the click
   * through and naming the problem is both clearer and more accessible.
   */
  function checkName(): boolean {
    if (name.trim()) return true;
    setNameError("Enter a name so the room knows who you are.");
    return false;
  }

  async function post<T>(url: string, body: unknown): Promise<T | null> {
    const res = await fetchJson<T>(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setFormError(res.requestId ? `${res.error} (ref ${res.requestId})` : res.error);
      return null;
    }
    return res.data;
  }

  async function create() {
    setNameError(null);
    setCodeError(null);
    setFormError(null);
    if (!checkName()) return;
    setBusy("create");
    const data = await post<{ code: string }>("/api/games", { nickname: name });
    setBusy(null);
    if (data?.code) router.push(`/game/${data.code}`);
  }

  async function join() {
    setNameError(null);
    setCodeError(null);
    setFormError(null);
    const nameOk = checkName();
    const c = code.trim().toUpperCase();
    let codeOk = true;
    if (!c) {
      setCodeError("Enter the code the host gave you.");
      codeOk = false;
    } else if (c.length !== CODE_LENGTH) {
      setCodeError(`Room codes are ${CODE_LENGTH} characters — you have ${c.length}.`);
      codeOk = false;
    }
    // Both problems are reported at once; fixing one only to be told about the
    // other is exactly the loop we are trying to avoid.
    if (!nameOk || !codeOk) return;

    setBusy("join");
    const data = await post<{ ok: boolean }>(`/api/games/${c}/join`, { nickname: name });
    setBusy(null);
    if (data) router.push(`/game/${c}`);
  }

  return (
    <main className="mx-auto max-w-lg px-6 py-16 sm:py-24">
      <header className="mb-10">
        <Wordmark size="full" asLink={false} />
        <p className="mt-5 max-w-md text-label-300">
          Everyone draws one line of the same picture. One of you has not been told
          what it is — and is trying not to look like it.
        </p>
      </header>

      <Plaque className="space-y-8">
        {/* Step one exists to make it obvious the name is needed either way. */}
        <div>
          <p className="catalogue-no mb-3">01 — Who are you?</p>
          <Field
            label="Your name"
            required
            autoFocus
            value={name}
            maxLength={24}
            placeholder="e.g. Hopper"
            error={nameError}
            hint="Everyone in the room sees this. Needed to create or join."
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
        </div>

        <div>
          <p className="catalogue-no mb-3">02 — Start or join a room</p>

          <Button
            variant="primary"
            onClick={create}
            disabled={busy !== null}
            className="w-full justify-center"
          >
            {busy === "create" ? "Creating…" : "Create a new room"}
          </Button>

          <div className="my-5 flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-wall-500" />
            <span className="label-caps">or join one</span>
            <span className="h-px flex-1 bg-wall-500" />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="flex-1">
              <Field
                label="Room code"
                mono
                value={code}
                maxLength={CODE_LENGTH}
                placeholder="ABC234"
                error={codeError}
                hint={`${CODE_LENGTH} characters, from the host.`}
                onChange={(e) => {
                  // Strip anything outside the code alphabet as it is typed,
                  // so an O or a zero never becomes a puzzling failure later.
                  setCode(e.target.value.toUpperCase().replace(CODE_ALPHABET, ""));
                  if (codeError) setCodeError(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && join()}
              />
            </div>
            <Button
              variant="secondary"
              onClick={join}
              disabled={busy !== null}
              className="sm:mt-6"
            >
              {busy === "join" ? "Joining…" : "Join room"}
            </Button>
          </div>
        </div>

        {formError && (
          <p role="alert" className="text-sm text-danger">
            {formError}
          </p>
        )}
      </Plaque>

      <p className="mt-8 text-xs text-label-500">
        3 to 10 players. No account needed —{" "}
        <a href="/design-system" className="underline hover:text-label-300">
          design system
        </a>
      </p>
    </main>
  );
}
