"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useI18n } from "@/hooks/useI18n";
import { normalizeCustomPanelLines, parseAnsiLine } from "@/lib/ansi";
import { asBracketedPaste, toTerminalKeyData } from "@/lib/terminal-input";
import type { ExtensionUiRequest } from "@/lib/types";

const FOCUSABLE_SELECTOR = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]):not([tabindex='-1']), [tabindex]:not([tabindex='-1'])";

export type ExtensionDialogRequest = Extract<
  ExtensionUiRequest,
  { method: "select" | "confirm" | "input" | "editor" }
>;
export type ExtensionCustomRequest = Extract<ExtensionUiRequest, { method: "custom" }>;
type ExtensionDialogResponse =
  | { value: string }
  | { confirmed: boolean }
  | { cancelled: true };

function useOverlayFocus(
  dialogRef: RefObject<HTMLElement | null>,
  identity: string,
  initialFocusRef?: RefObject<HTMLElement | null>,
) {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const declared = dialog.querySelector<HTMLElement>("[data-overlay-autofocus='true']");
      const first = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (initialFocusRef?.current ?? declared ?? first ?? dialog).focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      previousFocusRef.current?.focus();
    };
  }, [dialogRef, identity, initialFocusRef]);

  return useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) {
      event.preventDefault();
      dialog.focus();
    } else if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, [dialogRef]);
}

export function ExtensionDialog({ request, onRespond }: {
  request: ExtensionDialogRequest;
  onRespond: (request: ExtensionDialogRequest, response: ExtensionDialogResponse) => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const fieldId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const handleOverlayKeyDown = useOverlayFocus(dialogRef, request.id);
  const [value, setValue] = useState(
    request.method === "editor" ? request.prefill ?? "" : "",
  );

  useEffect(() => {
    setValue(request.method === "editor" ? request.prefill ?? "" : "");
  }, [request]);

  const cancel = () => onRespond(request, { cancelled: true });
  const submit = () => request.method === "confirm"
    ? onRespond(request, { confirmed: true })
    : onRespond(request, { value });

  return (
    <div className="extension-overlay">
      <div className="extension-overlay-mask" aria-hidden="true" />
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="extension-dialog"
        onKeyDown={(event) => {
          handleOverlayKeyDown(event);
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancel();
          }
        }}
      >
        <header className="extension-dialog-header">
          <div className="extension-dialog-heading">
            <h2 id={titleId} className="extension-dialog-title">{request.title}</h2>
            <span className="extension-dialog-kicker">{t("chat.extensionRequest")}</span>
          </div>
          <button type="button" className="extension-dialog-close" onClick={cancel} aria-label={t("chat.cancel")}>×</button>
        </header>
        <div className="extension-dialog-body">
          {request.method === "confirm" && <p className="extension-dialog-message">{request.message}</p>}
          {request.method === "select" && (
            <div className="extension-dialog-options">
              {request.options.map((option, index) => (
                <button
                  key={option}
                  type="button"
                  data-overlay-autofocus={index === 0 ? "true" : undefined}
                  className="extension-dialog-option"
                  onClick={() => onRespond(request, { value: option })}
                >{option}</button>
              ))}
            </div>
          )}
          {request.method === "input" && (
            <input
              id={fieldId}
              data-overlay-autofocus="true"
              className="extension-dialog-input"
              value={value}
              placeholder={request.placeholder}
              aria-label={request.title}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") submit(); }}
            />
          )}
          {request.method === "editor" && (
            <textarea
              id={fieldId}
              data-overlay-autofocus="true"
              className="extension-dialog-editor"
              value={value}
              aria-label={request.title}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submit();
              }}
            />
          )}
        </div>
        <footer className="extension-dialog-actions">
          <button type="button" className="extension-dialog-button is-secondary" onClick={cancel}>{t("chat.cancel")}</button>
          {request.method === "confirm" && (
            <button type="button" data-overlay-autofocus="true" className="extension-dialog-button is-primary" onClick={submit}>{t("chat.confirm")}</button>
          )}
          {(request.method === "input" || request.method === "editor") && (
            <button type="button" className="extension-dialog-button is-primary" onClick={submit}>{t("chat.submit")}</button>
          )}
        </footer>
      </div>
    </div>
  );
}

function renderAnsiLine(line: string, keyPrefix: string): ReactNode[] {
  return parseAnsiLine(line).map((segment, index) => (
    Object.keys(segment.style).length > 0
      ? <span key={`${keyPrefix}-${index}`} style={segment.style}>{segment.text}</span>
      : segment.text
  ));
}

export function ExtensionCustomPanel({
  request,
  onInput,
}: {
  request: ExtensionCustomRequest;
  onInput: (request: ExtensionCustomRequest, data: string) => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const displayLines = normalizeCustomPanelLines(request.lines);
  const handleOverlayKeyDown = useOverlayFocus(dialogRef, request.id, inputRef);

  useEffect(() => {
    inputRef.current?.focus();
  }, [request.id]);

  return (
    <div className="extension-overlay">
      <div className="extension-overlay-mask" aria-hidden="true" />
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="extension-custom-panel"
        onKeyDown={handleOverlayKeyDown}
        onClick={(event) => {
          if (!(event.target as HTMLElement).closest("button")) inputRef.current?.focus();
        }}
      >
        <textarea
          ref={inputRef}
          tabIndex={-1}
          className="extension-custom-capture"
          aria-label={t("chat.extensionInput")}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={(event) => {
            if (composingRef.current || event.nativeEvent.isComposing) return;
            const data = toTerminalKeyData(event);
            if (!data) return;
            event.preventDefault();
            event.stopPropagation();
            onInput(request, data);
          }}
          onInput={(event) => {
            if (composingRef.current || event.nativeEvent.isComposing) return;
            const text = event.currentTarget.value;
            event.currentTarget.value = "";
            if (text) onInput(request, text);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            const input = event.currentTarget;
            queueMicrotask(() => {
              const text = input.value;
              input.value = "";
              if (text) onInput(request, text);
            });
          }}
          onPaste={(event) => {
            event.preventDefault();
            const text = event.clipboardData.getData("text");
            if (text) onInput(request, asBracketedPaste(text));
          }}
        />
        <header className="extension-custom-header">
          <h2 id={titleId} className="extension-custom-title">{t("chat.extensionPanel")}</h2>
          <button type="button" className="extension-custom-close" onClick={() => onInput(request, "\x03")}>{t("chat.close")}</button>
        </header>
        <pre className="extension-custom-output">
          {(displayLines.length ? displayLines : [""]).map((line, index, allLines) => (
            <Fragment key={index}>
              {renderAnsiLine(line, `line-${index}`)}
              {index < allLines.length - 1 ? "\n" : null}
            </Fragment>
          ))}
        </pre>
      </div>
    </div>
  );
}
