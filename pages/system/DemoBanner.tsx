import { useNavigate } from 'react-router-dom';
import { useSession } from '../../state';
import { Banner } from '../../components/ui/Banner';
import './system.css';

/** "Demo workspace…" banner shown on every page in demo mode, with "Sign in" (ST-10#AC2). */
export function DemoBanner() {
  const { mode } = useSession();
  const navigate = useNavigate();
  if (mode !== 'demo') return null;
  return (
    <div className="pcp-demo-banner">
      <Banner tone="neutral" action={{ label: 'Sign in', onClick: () => navigate('/login') }}>
        Demo workspace. Changes stay in this browser. Sign in to use your organisation&apos;s data.
      </Banner>
    </div>
  );
}
