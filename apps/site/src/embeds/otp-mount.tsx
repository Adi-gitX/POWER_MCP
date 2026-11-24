/**
 * Mounts the OtpInput component on the server-rendered sign-in code page.
 *
 * The page is plain HTML from the MCP server, so this file is compiled into
 * a standalone bundle (scripts/build-otp.mjs) that the server serves at
 * /assets/otp/otp.js. It finds the page's form, renders the component in
 * place of the fallback boxes, and writes every change into the form's real
 * `code` field: that field is still what gets submitted and checked.
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { OtpInput, type OtpStatus } from "@/components/ui/otp-input";

declare global {
  interface Window {
    __powerOtpFallback?: () => void;
  }
}

function CodeField({
  field,
  form,
  initialError,
  locked,
}: {
  field: HTMLInputElement;
  form: HTMLFormElement;
  initialError: string;
  locked: boolean;
}) {
  const [status, setStatus] = useState<OtpStatus>(initialError ? "error" : "idle");
  const [message, setMessage] = useState(initialError);

  return (
    <OtpInput
      length={6}
      mode="numeric"
      label="Sign-in code"
      autoFocus={!locked}
      disabled={locked}
      status={status}
      errorMessage={message}
      successMessage="Checking your code…"
      hint="Type or paste the 6 digits from the email."
      onChange={(value) => {
        field.value = value;
        if (status !== "idle" && value.length < 6) setStatus("idle");
      }}
      onComplete={(value) => {
        field.value = value;
        setStatus("success");
        if (form.dataset.sent) return;
        form.dataset.sent = "1";
        form.requestSubmit ? form.requestSubmit() : form.submit();
      }}
      className="w-full"
    />
  );
}

function mount() {
  const form = document.getElementById("code-form") as HTMLFormElement | null;
  const field = document.getElementById("code") as HTMLInputElement | null;
  const slot = document.querySelector<HTMLElement>("[data-otp-react]");
  if (!form || !field || !slot) return;

  // The server's message about a wrong code moves into the component, so it
  // is said once, next to the boxes it is about.
  const warn = document.querySelector<HTMLElement>("[data-code-error]");
  const initialError = warn?.textContent?.trim() ?? "";
  if (warn) warn.hidden = true;

  document.querySelector<HTMLElement>("[data-otp]")?.setAttribute("hidden", "");
  form.dataset.otp = "react";
  field.tabIndex = -1;
  slot.hidden = false;
  form.addEventListener("submit", (event) => {
    if (!/^\d{6}$/.test(field.value)) {
      event.preventDefault();
      delete form.dataset.sent;
    }
  });
  createRoot(slot).render(
    <CodeField field={field} form={form} initialError={initialError} locked={field.disabled} />,
  );
}

try {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
} catch (error) {
  console.error("[power] code input failed to load; using the plain boxes", error);
  window.__powerOtpFallback?.();
}
