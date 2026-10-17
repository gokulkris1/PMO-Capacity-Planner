import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Banner, Button, CodeInput, FormField, LinkButton, PasswordField, TextField } from '../../components/ui';
import { useClientGaps } from '../../state';
import { AuthForm, AuthLayout, MIN_PASSWORD, authErrorMessage, isEmail } from './AuthLayout';

/**
 * Forgot / reset password (ST-07#AC3): always "If an account exists for {email}, we've sent a code." and never
 * displays a code.
 */
export default function ResetPasswordPage() {
  const gaps = useClientGaps();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [step, setStep] = useState<'request' | 'confirm'>('request');
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; code?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const request = async () => {
    if (!isEmail(email)) {
      setErrors({ email: 'Enter your work email address.' });
      return;
    }
    setErrors({});
    setBusy(true);
    setError(null);
    try {
      await gaps.auth.requestPasswordReset(email.trim());
    } catch {
      // Same message whether or not the account exists (no account enumeration, HS-13).
    } finally {
      setBusy(false);
      setStep('confirm');
    }
  };

  const confirm = async () => {
    const errs: typeof errors = {};
    if (!/^\d{6}$/.test(code)) errs.code = 'Enter the 6-digit code.';
    if (password.length < MIN_PASSWORD) errs.password = `Use at least ${MIN_PASSWORD} characters.`;
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError(null);
    try {
      await gaps.auth.confirmPasswordReset({ email: email.trim(), code, newPassword: password });
      navigate(`/login?reset=1&email=${encodeURIComponent(email.trim())}`, { replace: true });
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const back = (
    <LinkButton variant="link" to="/login" iconBefore={ArrowLeft}>
      Back to sign in
    </LinkButton>
  );

  if (step === 'request') {
    return (
      <AuthLayout
        title="Reset your password"
        subtitle="Enter your email and we'll send you a 6-digit code."
        footer={back}
        showValue={false}
      >
        <AuthForm onSubmit={() => void request()}>
          <FormField label="Email" error={errors.email}>
            <TextField
              size="lg"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-autofocus=""
            />
          </FormField>
          <div className="pcp-auth__actions">
            <Button type="submit" variant="primary" size="lg" fullWidth loading={busy}>
              Send code
            </Button>
          </div>
        </AuthForm>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Choose a new password"
      documentTitle="Reset your password"
      subtitle={
        <>
          If an account exists for <strong>{email.trim()}</strong>, we&apos;ve sent a code.
        </>
      }
      footer={back}
      showValue={false}
    >
      <AuthForm onSubmit={() => void confirm()}>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <div className="pcp-field">
          <span className="pcp-field__label" id="reset-code-label">
            6-digit code
          </span>
          <CodeInput
            label="6-digit code"
            value={code}
            onChange={setCode}
            invalid={!!errors.code}
            focusOnMount
            aria-describedby={errors.code ? 'reset-code-error' : undefined}
          />
          {errors.code ? (
            <p id="reset-code-error" className="pcp-field__error">
              {errors.code}
            </p>
          ) : null}
        </div>
        <FormField label="New password" error={errors.password} help={`At least ${MIN_PASSWORD} characters.`}>
          <PasswordField
            size="lg"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </FormField>
        <div className="pcp-auth__actions">
          <Button type="submit" variant="primary" size="lg" fullWidth loading={busy}>
            Reset password
          </Button>
          <div className="pcp-auth__links">
            Didn&apos;t get it?{' '}
            <Button variant="link" onClick={() => setStep('request')}>
              Send a new code
            </Button>
          </div>
        </div>
      </AuthForm>
    </AuthLayout>
  );
}
