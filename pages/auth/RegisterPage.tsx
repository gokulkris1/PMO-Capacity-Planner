import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Banner, Button, FormField, PasswordField, TextField } from '../../components/ui';
import { SIGNUP_ENABLED } from '../../components/shell/env';
import { useClientGaps } from '../../state';
import { NotFoundPage } from '../system/SystemPages';
import { AuthForm, AuthLayout, MIN_PASSWORD, authErrorMessage, isEmail } from './AuthLayout';

/** Create account (public mode, or internal with VITE_ALLOW_PUBLIC_SIGNUP); verification follows (AC-07). */
export default function RegisterPage() {
  const gaps = useClientGaps();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!SIGNUP_ENABLED) return <NotFoundPage fullPage />;

  const submit = async () => {
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = 'Enter your name.';
    if (!isEmail(email)) errs.email = 'Enter your work email address.';
    if (password.length < MIN_PASSWORD) errs.password = `Use at least ${MIN_PASSWORD} characters.`;
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError(null);
    try {
      await gaps.auth.register({ name: name.trim(), email: email.trim(), password });
      navigate(`/verify-email?email=${encodeURIComponent(email.trim())}`);
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="We'll email you a code to verify your address."
      footer={
        <span className="pcp-auth__links">
          Already have an account? <Link to="/login">Sign in</Link>
        </span>
      }
    >
      <AuthForm onSubmit={() => void submit()}>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <FormField label="Full name" error={errors.name}>
          <TextField
            size="lg"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-autofocus=""
          />
        </FormField>
        <FormField label="Work email" error={errors.email}>
          <TextField
            size="lg"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </FormField>
        <FormField
          label="Password"
          error={errors.password}
          help={`At least ${MIN_PASSWORD} characters. A short phrase works well.`}
        >
          <PasswordField
            size="lg"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </FormField>
        <div className="pcp-auth__actions">
          <Button type="submit" variant="primary" size="lg" fullWidth loading={busy}>
            Create account
          </Button>
        </div>
      </AuthForm>
    </AuthLayout>
  );
}
