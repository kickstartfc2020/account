type ObservabilityLevel = 'info' | 'warn' | 'error';

type ObservabilityPayload = {
  level: ObservabilityLevel;
  scope: string;
  message: string;
  error?: string;
  meta?: Record<string, unknown>;
  timestamp: string;
  appUrl?: string;
};

const endpoint = import.meta.env.VITE_CLIENT_LOG_ENDPOINT as string | undefined;
const appUrl = import.meta.env.VITE_APP_URL as string | undefined;

function normalizeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'unknown_error';
  }
}

function sendToEndpoint(payload: ObservabilityPayload) {
  if (!endpoint) return;

  const body = JSON.stringify(payload);

  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const blob = new Blob([body], { type: 'application/json' });
    navigator.sendBeacon(endpoint, blob);
    return;
  }

  void fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {
    // Never throw from observability transport.
  });
}

function emit(level: ObservabilityLevel, scope: string, message: string, error?: unknown, meta?: Record<string, unknown>) {
  const payload: ObservabilityPayload = {
    level,
    scope,
    message,
    error: error === undefined ? undefined : normalizeError(error),
    meta,
    timestamp: new Date().toISOString(),
    appUrl,
  };

  if (level === 'error') {
    console.error(`[${scope}] ${message}`, { error: payload.error, meta });
  } else if (level === 'warn') {
    console.warn(`[${scope}] ${message}`, { meta });
  } else {
    console.info(`[${scope}] ${message}`, { meta });
  }

  sendToEndpoint(payload);
}

export function reportOperationalInfo(scope: string, message: string, meta?: Record<string, unknown>) {
  emit('info', scope, message, undefined, meta);
}

export function reportOperationalWarning(scope: string, message: string, meta?: Record<string, unknown>) {
  emit('warn', scope, message, undefined, meta);
}

export function reportOperationalError(scope: string, message: string, error?: unknown, meta?: Record<string, unknown>) {
  emit('error', scope, message, error, meta);
}

export function installGlobalErrorHandlers() {
  if (typeof window === 'undefined') return;

  window.addEventListener('error', (event) => {
    reportOperationalError('frontend.window_error', 'Unhandled window error', event.error ?? event.message, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    reportOperationalError('frontend.unhandled_rejection', 'Unhandled promise rejection', event.reason);
  });

  window.addEventListener('offline', () => {
    reportOperationalWarning('frontend.network', 'Browser reported offline state');
  });

  window.addEventListener('online', () => {
    reportOperationalInfo('frontend.network', 'Browser restored online state');
  });
}
