import { useState } from 'react';

const ACCESS_CODE = import.meta.env.VITE_ACCESS_CODE as string;
const SESSION_KEY = 'access_granted';

export default function AccessGate({ children }: { children: React.ReactNode }) {
  const [granted, setGranted] = useState(() => sessionStorage.getItem(SESSION_KEY) === '1');
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);

  if (granted) return <>{children}</>;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (ACCESS_CODE && input === ACCESS_CODE) {
      sessionStorage.setItem(SESSION_KEY, '1');
      setGranted(true);
    } else {
      setError(true);
      setInput('');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm p-8 rounded-xl border border-border shadow-lg space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold">AI Internal Tool</h1>
          <p className="text-sm text-muted-foreground">Enter access code to continue</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            autoFocus
            type="password"
            value={input}
            onChange={e => { setInput(e.target.value); setError(false); }}
            placeholder="Access code"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring transition-[box-shadow] placeholder:text-muted-foreground"
          />
          {error && <p className="text-xs text-destructive">Incorrect code. Try again.</p>}
          <button
            type="submit"
            className="w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Enter
          </button>
        </form>
      </div>
    </div>
  );
}
