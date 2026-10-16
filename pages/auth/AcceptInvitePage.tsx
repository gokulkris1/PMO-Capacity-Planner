import { RoutePlaceholder } from '../../components/shell/RoutePlaceholder';

// Temporary stand-in (checkpoint 1); replaced by the full page in the next commit.
export default function Page() {
  return (
    <RoutePlaceholder
      spec={{ title: 'Accept invitation', story: 'AC-05', module: 'pages/auth/AcceptInvitePage.tsx' }}
    />
  );
}
