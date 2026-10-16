import { RoutePlaceholder } from '../../components/shell/RoutePlaceholder';

// Temporary stand-in (checkpoint 1); replaced by the full page in the next commit.
export default function Page() {
  return (
    <RoutePlaceholder
      spec={{ title: 'Members and roles', story: 'ST-02', module: 'pages/settings/MembersSettings.tsx' }}
    />
  );
}
