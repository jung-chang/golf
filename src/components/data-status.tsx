import { CloudCheck, CloudOff, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { load, sync, useStore } from '@/lib/store';

export function LoadingScreen({ label = 'Loading your golf…' }: { label?: string }) {
  return <div role="status" className="flex min-h-48 items-center justify-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="size-5 animate-spin" />{label}</div>;
}
export function LoadError({ message, retry = () => void load() }: { message: string; retry?: () => void }) {
  return <div role="alert" className="m-4 space-y-3 rounded-2xl border bg-card p-5"><p className="font-semibold">Couldn't load this screen</p><p className="text-sm text-muted-foreground">{message}</p><Button variant="outline" className="min-h-11" onClick={retry}><RefreshCw />Try again</Button></div>;
}
export function SyncStatus() {
  const status = useStore((s) => s.syncStatus);
  const failedSave = useStore((s) => s.saveError);
  const loaded = useStore((s) => s.loaded);
  const pending = useStore((s) => s.pending);
  const saving = useStore((s) => s.saving);
  const error = useStore((s) => s.error);
  if (!loaded) return error ? <LoadError message={error} /> : <LoadingScreen label="Opening saved golf data…" />;
  const retry = failedSave || status === 'error' || status === 'pending';
  const text = failedSave ? 'Not saved on this phone. Keep the app open and retry.'
    : saving ? 'Saving on this phone…'
    : status === 'syncing' ? 'Syncing…'
    : status === 'synced' ? 'Saved and synced'
    : status === 'offline' ? `Saved on phone · offline${pending ? ' · waiting to sync' : ''}`
    : status === 'error' ? 'Saved on phone · sync needs a retry' : 'Saving changes…';
  return <div className="flex min-h-11 items-center justify-between gap-2 text-sm text-muted-foreground" role="status">
    <span className="flex items-center gap-2">{status === 'syncing' ? <Loader2 className="size-4 shrink-0 animate-spin" /> : status === 'synced' ? <CloudCheck className="size-4 shrink-0" /> : <CloudOff className="size-4 shrink-0" />}{text}</span>
    {retry && <Button variant="ghost" className="min-h-11 shrink-0 px-2 text-primary" onClick={() => void sync()}>Retry</Button>}
  </div>;
}
