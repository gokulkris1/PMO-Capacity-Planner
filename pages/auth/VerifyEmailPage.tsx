import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { useSession } from '../../state';
import { Banner, Button, CodeInput, Icon, LinkButton } from '../../components/ui';
import { useClientGaps } from '../../state';
import { useHomeHref } from '../../components/shell/guards';
import { AuthForm, AuthLayout, authErrorMessage } from './AuthLayout';

const RESEND_SECONDS = 30;

/** Verify email (AC-07#AC3): 6-digit code, resend after 30 s; then continue to the workspace or /create. */
export default function VerifyEmailPage() {
  const gaps = useClientGaps();
  const { me, status, refreshMe } = useSession();
  const navigate = useNavigate();
  const home = useHomeHref();
  const [params] = useSearchParams();
  const email = params.get('email') ?? me?.user.email ?? '';
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendIn]);

  const verify = async (value = code) => {
    if (!/^\d{6}$/.test(value)) {
      setError('Enter the 6-digit code.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await gaps.auth.checkVerification({ email, code: value });
      if (status === 'authenticated') {
        await refreshMe();
        navigate(home ?? '/create', { replace: true });
      } else navigate(`/login?verified=1&email=${encodeURIComponent(email)}`, { replace: true });
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(null);
    setResendIn(RESEND_SECONDS);
    try {
      await gaps.auth.sendVerification(email);
      setNotice(`We sent a new code to ${email}.`);
    } catch (e) {
      setError(authErrorMessage(e));
    }
  };

  // QA-027 (ST-07#AC4): signed out and no address to verify: the code form could not succeed, so ask to sign in.
  if (status === 'anonymous' && !email) {
    return (
      <AuthLayout
        title="Verify your email"
        subtitle="Sign in first, then enter the 6-digit code we emailed to you."
        showValue={false}
      >
        <div className="pcp-auth__actions">
          <LinkButton variant="primary" size="lg" to={`/login?next=${encodeURIComponent('/verify-email')}`}>
            Sign in to verify
          </LinkButton>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Verify your email"
      subtitle={
        email ? (
          <>
            Enter the 6-digit code we emailed to <strong>{email}</strong>.
          </>
        ) : (
          'Enter the 6-digit code we emailed to you.'
        )
      }
      showValue={false}
      footer={
        <LinkButton variant="link" to="/login" iconBefore={ArrowLeft}>
          Back to sign in
        </LinkButton>
      }
    >
      <AuthForm onSubmit={() => void verify()}>
        {notice && !error ? (
          <Banner tone="success" icon={MailCheck}>
            {notice}
          </Banner>
        ) : null}
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <div className="pcp-auth__code">
          <Icon icon={MailCheck} size={32} className="pcp-text-tertiary" />
          <CodeInput
            label="Verification code"
            value={code}
            onChange={setCode}
            onComplete={(v) => void verify(v)}
            invalid={!!error}
            focusOnMount
          />
        </div>
        <div className="pcp-auth__actions">
          <Button type="submit" variant="primary" size="lg" fullWidth loading={busy}>
            Verify email
          </Button>
          <div className="pcp-auth__links">
            <Button variant="link" disabled={resendIn > 0 || !email} onClick={() => void resend()}>
              {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
            </Button>
          </div>
        </div>
      </AuthForm>
    </AuthLayout>
  );
}
