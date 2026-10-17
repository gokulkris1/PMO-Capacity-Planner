import type { FormEvent, ReactNode } from 'react';
import { Wordmark } from '../../components/shell/ProductMark';
import { APP_VERSION } from '../../components/shell/env';
import { useDocumentTitle } from '../../components/ui/hooks';
import { ApiRequestError } from '../../state';
import './auth.css';

export const VALUE_PROPOSITION = "Plan your PMO squad's crafts, demand and capacity across the next four quarters.";

/**
 * Sign-in family layout (ST-07#AC1, #AC6): wordmark, one-line value proposition and a centred card on
 * --color-bg. No hero imagery, gradients or oversized type.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
  documentTitle,
  showValue = true,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  documentTitle?: string;
  showValue?: boolean;
}) {
  useDocumentTitle(documentTitle ?? title);
  return (
    <div className="pcp-auth">
      <main id="main" tabIndex={-1} className="pcp-auth__main">
        <div className="pcp-auth__brand">
          <Wordmark size="lg" />
          {showValue ? <p className="pcp-auth__value">{VALUE_PROPOSITION}</p> : null}
        </div>
        <section className="pcp-auth__card" aria-labelledby="auth-title">
          <header className="pcp-auth__header">
            <h1 id="auth-title" className="pcp-auth__title">
              {title}
            </h1>
            {subtitle ? <p className="pcp-auth__subtitle">{subtitle}</p> : null}
          </header>
          {children}
        </section>
        {footer ? <div className="pcp-auth__footer">{footer}</div> : null}
      </main>
      <footer className="pcp-auth__legal">
        <span>PMO Capacity Planner · v{APP_VERSION}</span>
      </footer>
    </div>
  );
}

/** Form wrapper with consistent spacing; prevents default submit. */
export function AuthForm({ onSubmit, children }: { onSubmit: () => void; children: ReactNode }) {
  return (
    <form
      className="pcp-auth__form"
      noValidate
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
    </form>
  );
}

/** Plain-language error copy; never shows raw server text (DESIGN_SYSTEM §14). */
export function authErrorMessage(err: unknown, context: 'login' | 'generic' = 'generic'): string {
  if (err instanceof ApiRequestError) {
    // QA-021 (HS-05#AC3): the API says how long to wait ("Too many attempts. Try again in 9 minutes.").
    if (err.status === 429)
      return /^Too many attempts\. Try again in \d+ minutes?\.$/.test(err.message)
        ? err.message
        : 'Too many attempts. Wait a few minutes and try again.';
    if (context === 'login' && (err.status === 401 || err.status === 400)) return 'Email or password is incorrect.';
    if (err.status === 501) return "This isn't available yet. Try again later.";
    if (err.status === 400 && err.message && !/sql|stack|exception/i.test(err.message)) return err.message;
    if (err.status === 403 && err.message && !/sql|stack|exception/i.test(err.message)) return err.message;
    if (err.status === 404) return 'We could not find that. Check the link and try again.';
    return err.requestId
      ? `Something went wrong. Try again, or quote reference ${err.requestId}.`
      : 'Something went wrong. Try again.';
  }
  return 'Something went wrong. Try again.';
}

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
export const MIN_PASSWORD = 10;
