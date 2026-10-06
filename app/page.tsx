"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { Button, Field, Plaque } from "@/lib/ui/primitives";
import { Wordmark } from "@/lib/ui/Wordmark";
import { loadNickname, saveNickname } from "@/lib/ui/rememberedName";

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
  const [remembered, setRemembered] = useState(false);

  /**
   * Loaded after mount, not during render: the server has no localStorage, so
   * seeding state from it directly would be a hydration mismatch. Only fills a
   * field the user has not already started typing into.
   */
  useEffect(() => {
    const saved = loadNickname();
    if (!saved) return;
    setName((current) => {
      if (current) return current;
      setRemembered(true);
      return saved;
    });
  }, []);

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
    if (data?.code) {
      saveNickname(name);
      router.push(`/game/${data.code}`);
    }
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
    if (data) {
      saveNickname(name);
      router.push(`/game/${c}`);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-16 sm:py-24">
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
            hint={
              remembered
                ? "Remembered on this device. Change it if you like."
                : "Everyone in the room sees this. Needed either way."
            }
            onChange={(e) => {
              setName(e.target.value);
              setRemembered(false);
              if (nameError) setNameError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
        </div>

        <div>
          <p className="catalogue-no mb-3">02 — Then pick one</p>

          {/* The two routes are built from the same parts in the same order --
              heading, one line of explanation, controls, button -- so that
              "create" and "join" read as alternatives rather than a step and
              an afterthought. */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
            <section className="flex flex-1 flex-col rounded-sm border border-wall-500 bg-wall-900/60 p-4">
              <h2 className="font-display text-xl leading-tight text-label-100">
                Start a new room
              </h2>
              <p className="mt-1.5 text-xs text-label-500">
                You get a code to read out. Everyone else joins with it.
              </p>
              <Button
                variant="primary"
                onClick={create}
                disabled={busy !== null}
                className="mt-4 w-full justify-center sm:mt-auto"
              >
                {busy === "create" ? "Creating…" : "Create a new room"}
              </Button>
            </section>

            <div
              className="flex items-center gap-3 sm:w-px sm:flex-col sm:gap-2 sm:self-stretch"
              aria-hidden
            >
              <span className="h-px flex-1 bg-wall-500 sm:h-auto sm:w-px sm:flex-1" />
              <span className="label-caps">or</span>
              <span className="h-px flex-1 bg-wall-500 sm:h-auto sm:w-px sm:flex-1" />
            </div>

            <section className="flex flex-1 flex-col rounded-sm border border-wall-500 bg-wall-900/60 p-4">
              <h2 className="font-display text-xl leading-tight text-label-100">
                Join a room
              </h2>
              <p className="mt-1.5 text-xs text-label-500">
                Someone already made one and gave you its code.
              </p>
              <div className="mt-4">
                <Field
                  label="Room code"
                  mono
                  required
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
                className="mt-3 w-full justify-center"
              >
                {busy === "join" ? "Joining…" : "Join room"}
              </Button>
            </section>
          </div>
        </div>

        {formError && (
          <p role="alert" className="text-sm text-danger">
            {formError}
          </p>
        )}
      </Plaque>

      <p className="mt-8 text-xs text-label-500">
        3 to 10 players. No account needed.
      </p>
    </main>
  );
}
