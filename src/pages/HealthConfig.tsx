import { clientConfigurationHealth, isSupabaseConfigured } from '@/lib/supabase';

function StatusBadge({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
        ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
      }`}
    >
      {ok ? 'OK' : 'Missing'}
    </span>
  );
}

export default function HealthConfig() {
  const rows = [
    {
      label: 'VITE_SUPABASE_URL',
      ok: clientConfigurationHealth.supabaseUrlConfigured,
      detail: clientConfigurationHealth.supabaseUrlHost ?? 'not set',
    },
    {
      label: 'VITE_SUPABASE_ANON_KEY',
      ok: clientConfigurationHealth.supabaseAnonKeyConfigured,
      detail: clientConfigurationHealth.supabaseAnonKeyConfigured ? 'configured' : 'not set',
    },
    {
      label: 'VITE_APP_URL',
      ok: clientConfigurationHealth.appUrlConfigured,
      detail: clientConfigurationHealth.appUrlHost ?? 'not set',
    },
    {
      label: 'VITE_CLIENT_LOG_ENDPOINT',
      ok: clientConfigurationHealth.clientLogEndpointConfigured,
      detail: clientConfigurationHealth.clientLogEndpointHost ?? 'optional / not set',
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50 px-6 py-10">
      <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-display font-bold text-slate-900">Runtime Configuration Health</h1>
        <p className="mt-2 text-sm text-slate-600">
          This page shows sanitized runtime configuration status for deployment debugging.
        </p>

        <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
          <p>
            <span className="font-semibold text-slate-700">Environment:</span>{' '}
            <span className="text-slate-600">{clientConfigurationHealth.environment}</span>
          </p>
          <p className="mt-2">
            <span className="font-semibold text-slate-700">Supabase client initialized:</span>{' '}
            <StatusBadge ok={isSupabaseConfigured} />
          </p>
        </div>

        <div className="mt-6 space-y-3">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-800">{row.label}</p>
                <p className="text-xs text-slate-500">{row.detail}</p>
              </div>
              <StatusBadge ok={row.ok} />
            </div>
          ))}
        </div>

        {clientConfigurationHealth.configurationError ? (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {clientConfigurationHealth.configurationError}
          </div>
        ) : null}

        {clientConfigurationHealth.missingRequiredVariables.length > 0 ? (
          <div className="mt-4 text-xs text-red-600">
            Missing required vars: {clientConfigurationHealth.missingRequiredVariables.join(', ')}
          </div>
        ) : null}
      </div>
    </div>
  );
}
