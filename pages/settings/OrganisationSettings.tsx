import { RoutePlaceholder } from '../../components/shell/RoutePlaceholder';

// Temporary stand-in (checkpoint 1); replaced by the full page in the next commit.
export default function Page() {
  return (
    <RoutePlaceholder
      spec={{ title: 'Organisation', story: 'ST-01', module: 'pages/settings/OrganisationSettings.tsx' }}
    />
  );
}
