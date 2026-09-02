"use client";

import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
  Switch,
  Radio,
  RadioGroup,
  Tab,
  TabGroup,
  TabList,
  TabPanel,
  TabPanels,
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
} from "@headlessui/react";
import { clsx } from "clsx";
import type { ReactNode } from "react";
import { Button } from "./primitives";

/**
 * Headless UI wrappers.
 *
 * Behaviour, focus management, and ARIA come from Headless UI; everything
 * here is presentation. Keeping the styling in one place is what stops the
 * design language drifting as screens get built.
 */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-wall-950/80 backdrop-blur-sm" aria-hidden />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel
          className="w-full max-w-md rounded-sm border border-wall-500 bg-wall-700 p-6"
          style={{ boxShadow: "0 24px 64px -12px rgba(0,0,0,.7)" }}
        >
          <DialogTitle className="font-display text-2xl text-label-100">{title}</DialogTitle>
          <div className="mt-3 text-sm text-label-300">{children}</div>
          {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
        </DialogPanel>
      </div>
    </Dialog>
  );
}

export function Select<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <Listbox value={value} onChange={onChange}>
      <span className="label-caps">{label}</span>
      <div className="relative mt-1.5">
        <ListboxButton className="flex w-full items-center justify-between rounded-sm border border-wall-500 bg-wall-900 px-3 py-2 text-left text-sm text-label-100 data-[open]:border-accent-500">
          {options.find((o) => o.value === value)?.label}
          <span aria-hidden className="text-label-500">▾</span>
        </ListboxButton>
        <ListboxOptions
          anchor="bottom start"
          className="z-50 mt-1 w-[var(--button-width)] rounded-sm border border-wall-500 bg-wall-700 py-1 shadow-lg"
        >
          {options.map((o) => (
            <ListboxOption
              key={o.value}
              value={o.value}
              className="cursor-pointer px-3 py-1.5 text-sm text-label-300 data-[focus]:bg-wall-600 data-[selected]:text-accent-400"
            >
              {o.label}
            </ListboxOption>
          ))}
        </ListboxOptions>
      </div>
    </Listbox>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm text-label-100">{label}</p>
        {description && <p className="mt-0.5 text-xs text-label-500">{description}</p>}
      </div>
      <Switch
        checked={checked}
        onChange={onChange}
        className={clsx(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors",
          checked ? "bg-accent-500" : "bg-wall-500",
        )}
      >
        <span className="sr-only">{label}</span>
        <span
          className={clsx(
            "inline-block size-4 translate-y-0.5 rounded-full bg-paper transition-transform",
            checked ? "translate-x-4.5" : "translate-x-0.5",
          )}
        />
      </Switch>
    </div>
  );
}

export function Choice<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; description?: string }[];
}) {
  return (
    <RadioGroup value={value} onChange={onChange}>
      <span className="label-caps">{label}</span>
      <div className="mt-2 space-y-2">
        {options.map((o) => (
          <Radio
            key={o.value}
            value={o.value}
            className="flex cursor-pointer items-start gap-3 rounded-sm border border-wall-500 bg-wall-900 p-3 data-[checked]:border-accent-500 data-[checked]:bg-accent-500/5"
          >
            {({ checked }) => (
              <>
                <span
                  aria-hidden
                  className={clsx(
                    "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border",
                    checked ? "border-accent-500" : "border-wall-400",
                  )}
                >
                  {checked && <span className="size-2 rounded-full bg-accent-500" />}
                </span>
                <span>
                  <span className="block text-sm text-label-100">{o.label}</span>
                  {o.description && (
                    <span className="mt-0.5 block text-xs text-label-500">{o.description}</span>
                  )}
                </span>
              </>
            )}
          </Radio>
        ))}
      </div>
    </RadioGroup>
  );
}

export function Tabs({
  tabs,
}: {
  tabs: { label: string; content: ReactNode }[];
}) {
  return (
    <TabGroup>
      <TabList className="flex gap-1 border-b border-wall-500">
        {tabs.map((t) => (
          <Tab
            key={t.label}
            className="label-caps -mb-px border-b-2 border-transparent px-3 py-2 data-[selected]:border-accent-500 data-[selected]:text-label-100 data-[hover]:text-label-300 focus:outline-none"
          >
            {t.label}
          </Tab>
        ))}
      </TabList>
      <TabPanels className="pt-4">
        {tabs.map((t) => (
          <TabPanel key={t.label} className="text-sm text-label-300">
            {t.content}
          </TabPanel>
        ))}
      </TabPanels>
    </TabGroup>
  );
}

export function Accordion({ items }: { items: { q: string; a: ReactNode }[] }) {
  return (
    <div className="divide-y divide-wall-500 border-y border-wall-500">
      {items.map((it) => (
        <Disclosure key={it.q}>
          <DisclosureButton className="group flex w-full items-center justify-between py-3 text-left text-sm text-label-100">
            {it.q}
            <span aria-hidden className="text-label-500 group-data-[open]:rotate-180">▾</span>
          </DisclosureButton>
          <DisclosurePanel className="pb-3 text-sm text-label-500">{it.a}</DisclosurePanel>
        </Disclosure>
      ))}
    </div>
  );
}

export { Button };
