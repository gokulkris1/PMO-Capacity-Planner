import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, ShieldCheck } from 'lucide-react';
import { useSession } from '../../state';
import {
  Avatar,
  Banner,
  Button,
  Card,
  Dialog,
  FormField,
  PasswordField,
  StatusPill,
  Switch,
  TextField,
  useConfirm,
  useToast,
} from '../../components/ui';
import { useClientGaps } from '../../state';
import { SectionBody, SectionHeader, errorText } from './common';

const MIN_PASSWORD = 10;

/** Settings › Profile (ST-01#AC4, HS-14, AC-03#AC6). Visible to everyone. */
export default function ProfileSettings() {
  const { me, logout } = useSession();
  const gaps = useClientGaps();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [name, setName] = useState(me?.user.name ?? '');
  const [savingName, setSavingName] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwErrors, setPwErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const [savingPw, setSavingPw] = useState(false);
  const [twoFactor, setTwoFactor] = useState(me?.user.twoFactorEnabled ?? false);
  const [tfDialog, setTfDialog] = useState<null | boolean>(null);
  const [tfPassword, setTfPassword] = useState('');
  const [tfError, setTfError] = useState<string | null>(null);
  const [tfBusy, setTfBusy] = useState(false);

  if (!me) return null;

  const saveName = async () => {
    if (!name.trim()) return;
    setSavingName(true);
    try {
      await gaps.account.updateProfile({ name: name.trim() });
      toast.success('Profile saved');
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSavingName(false);
    }
  };

  const savePassword = async () => {
    const errs: typeof pwErrors = {};
    if (!pw.current) errs.current = 'Enter your current password.';
    if (pw.next.length < MIN_PASSWORD) errs.next = `Use at least ${MIN_PASSWORD} characters.`;
    if (pw.confirm !== pw.next) errs.confirm = "The passwords don't match.";
    setPwErrors(errs);
    if (Object.keys(errs).length) return;
    setSavingPw(true);
    try {
      await gaps.account.changePassword({ currentPassword: pw.current, newPassword: pw.next });
      setPw({ current: '', next: '', confirm: '' });
      toast.success('Password changed', { body: 'Other devices will need to sign in again.' });
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSavingPw(false);
    }
  };

  const applyTwoFactor = async () => {
    if (!tfPassword) {
      setTfError('Enter your password.');
      return;
    }
    if (tfDialog === null) return;
    setTfBusy(true);
    setTfError(null);
    try {
      await gaps.account.setTwoFactor({ enabled: tfDialog, currentPassword: tfPassword });
      setTwoFactor(tfDialog);
      toast.success(tfDialog ? 'Two-step verification is on' : 'Two-step verification is off');
      setTfDialog(null);
      setTfPassword('');
    } catch (e) {
      setTfError(errorText(e));
    } finally {
      setTfBusy(false);
    }
  };

  const signOutEverywhere = async () => {
    const ok = await confirm({
      title: 'Sign out of all devices?',
      body: 'You will be signed out here and on every other browser and device. Your data is not affected.',
      confirmLabel: 'Sign out everywhere',
      tone: 'danger',
    });
    if (!ok) return;
    await logout({ everywhere: true });
    navigate('/login', { replace: true });
  };

  const nameDirty = name.trim() !== me.user.name && name.trim().length > 0;

  return (
    <>
      <SectionHeader id="profile" />
      <SectionBody>
        <Card
          title="Personal details"
          footer={
            <div className="pcp-settings__footer">
              <Button variant="primary" disabled={!nameDirty} loading={savingName} onClick={() => void saveName()}>
                Save changes
              </Button>
            </div>
          }
        >
          <div className="pcp-settings__form">
            <div className="pcp-row pcp-row--md">
              <Avatar name={me.user.name} size={40} />
              <div className="pcp-stack pcp-stack--sm">
                <strong>{me.user.name}</strong>
                <span className="pcp-caption pcp-text-tertiary">{me.user.email}</span>
              </div>
            </div>
            <div className="pcp-settings__grid-2">
              <FormField label="Full name">
                <TextField value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} />
              </FormField>
              <FormField label="Email" help="Your sign-in email. Ask your Org Admin to change it.">
                <TextField value={me.user.email} readOnly />
              </FormField>
            </div>
          </div>
        </Card>

        <Card
          title="Password"
          subtitle={`At least ${MIN_PASSWORD} characters.`}
          footer={
            <div className="pcp-settings__footer">
              <Button
                variant="primary"
                disabled={!pw.current && !pw.next}
                loading={savingPw}
                onClick={() => void savePassword()}
              >
                Change password
              </Button>
            </div>
          }
        >
          <div className="pcp-settings__form">
            <FormField label="Current password" error={pwErrors.current}>
              <PasswordField
                autoComplete="current-password"
                value={pw.current}
                onChange={(e) => setPw({ ...pw, current: e.target.value })}
              />
            </FormField>
            <div className="pcp-settings__grid-2">
              <FormField label="New password" error={pwErrors.next}>
                <PasswordField
                  autoComplete="new-password"
                  value={pw.next}
                  onChange={(e) => setPw({ ...pw, next: e.target.value })}
                />
              </FormField>
              <FormField label="Confirm new password" error={pwErrors.confirm}>
                <PasswordField
                  autoComplete="new-password"
                  value={pw.confirm}
                  onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                />
              </FormField>
            </div>
          </div>
        </Card>

        <Card
          title="Two-step verification"
          actions={
            <StatusPill tone={twoFactor ? 'success' : 'neutral'} icon={twoFactor ? ShieldCheck : undefined}>
              {twoFactor ? 'On' : 'Off'}
            </StatusPill>
          }
        >
          <Switch
            checked={twoFactor}
            onChange={(on) => {
              setTfError(null);
              setTfPassword('');
              setTfDialog(on);
            }}
            label="Ask for a code from my email when I sign in"
            description="Adds a 6-digit code to every sign-in on a new session."
          />
        </Card>

        <Card title="Sessions">
          <div className="pcp-settings__row">
            <div className="pcp-settings__row-text">
              <span className="pcp-settings__row-title">Sign out of all devices</span>
              <span className="pcp-settings__row-desc">Use this if you signed in on a shared or lost device.</span>
            </div>
            <Button variant="secondary" iconBefore={LogOut} onClick={() => void signOutEverywhere()}>
              Sign out everywhere
            </Button>
          </div>
        </Card>
      </SectionBody>

      <Dialog
        open={tfDialog !== null}
        onClose={() => setTfDialog(null)}
        size="sm"
        title={tfDialog ? 'Turn on two-step verification?' : 'Turn off two-step verification?'}
        dismissible={!tfBusy}
        footer={
          <>
            <Button onClick={() => setTfDialog(null)} disabled={tfBusy}>
              Cancel
            </Button>
            <Button variant={tfDialog ? 'primary' : 'danger'} loading={tfBusy} onClick={() => void applyTwoFactor()}>
              {tfDialog ? 'Turn on' : 'Turn off'}
            </Button>
          </>
        }
      >
        <div className="pcp-settings__form">
          <p className="pcp-text-secondary">
            {tfDialog
              ? 'From your next sign-in we will email you a 6-digit code.'
              : 'Signing in will only need your password. Enter it to confirm.'}
          </p>
          {tfError ? <Banner tone="danger">{tfError}</Banner> : null}
          <FormField label="Password">
            <PasswordField
              autoComplete="current-password"
              value={tfPassword}
              onChange={(e) => setTfPassword(e.target.value)}
              data-autofocus=""
            />
          </FormField>
        </div>
      </Dialog>
    </>
  );
}
