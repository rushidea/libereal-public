'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  show: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

const toastTone: Record<
  ToastType,
  { box: string; icon: string }
> = {
  success: {
    box: 'border-[var(--brand-color-success-border)] bg-[var(--brand-color-success-bg)]',
    icon: 'text-[var(--brand-color-success)]',
  },
  error: {
    box: 'border-[var(--brand-color-error-border)] bg-[var(--brand-color-error-bg)]',
    icon: 'text-[var(--brand-color-error)]',
  },
  info: {
    box: 'border-[var(--brand-color-info-border)] bg-[var(--brand-color-info-bg)]',
    icon: 'text-[var(--brand-color-info)]',
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, type: ToastType = 'info') => {
    const id = `toast-${crypto.randomUUID()}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismiss = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="pointer-events-none fixed bottom-20 left-1/2 z-[calc(var(--site-overlay-z)+20)] flex -translate-x-1/2 flex-col gap-2 lg:bottom-6">
        {toasts.map((toast) => {
          const tone = toastTone[toast.type];
          const Icon =
            toast.type === 'success' ? CheckCircle : toast.type === 'error' ? AlertCircle : Info;
          return (
            <div
              key={toast.id}
              role="status"
              className={`toast-slide-up pointer-events-auto flex items-center gap-3 rounded-xl border px-4 py-3 shadow-lg backdrop-blur-sm ${tone.box}`}
            >
              <Icon className={`h-5 w-5 shrink-0 ${tone.icon}`} />
              <span className="whitespace-nowrap text-sm font-medium text-[var(--brand-color-text)]">
                {toast.message}
              </span>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="ml-2 rounded-full p-1 text-[var(--brand-color-text-quaternary)] transition-colors hover:bg-[color-mix(in_srgb,var(--brand-color-text)_8%,transparent)]"
                aria-label="关闭提示"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    return { show: () => {} };
  }
  return context;
}
