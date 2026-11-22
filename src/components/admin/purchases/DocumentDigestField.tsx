'use client';

import { useEffect, useRef, useState } from 'react';

export default function DocumentDigestField({ label, name, value, onChange, required }: {
  label: string;
  name?: string;
  value?: string;
  onChange?: (value: string) => void;
  required?: boolean;
}) {
  const [digest, setDigest] = useState('');
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const request = useRef(0);
  const onDigest = useRef(onChange);
  useEffect(() => { onDigest.current = onChange; }, [onChange]);

  function update(newDigest: string) {
    setDigest(newDigest);
    onDigest.current?.(newDigest);
  }

  return <div className="grid gap-1 text-xs">
    <label className="grid gap-1">
      {label}
      <input className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm" name={name}
        required={required} maxLength={64} pattern="[a-fA-F0-9]{64}" value={value ?? digest}
        onChange={event => { request.current += 1; setReading(false); setError(''); update(event.target.value); }}/>
    </label>
    <label className="text-slate-700">
      从手头文件生成{label}
      <input type="file" className="block max-w-full text-xs" onChange={async event => {
        const selected = event.currentTarget.files?.[0];
        if (!selected) return;
        const id = ++request.current;
        setError('');
        update('');
        setReading(true);
        try {
          const hash = await crypto.subtle.digest('SHA-256', await selected.arrayBuffer());
          if (id === request.current) update(Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''));
        } catch {
          if (id === request.current) setError('暂时无法读取文件，请重新选取文件或使用档案中已有的摘要。');
        } finally {
          if (id === request.current) setReading(false);
        }
      }}/>
    </label>
    {reading && <span role="status">正在核对文件…</span>}
    {error && <span role="alert">{error}</span>}
  </div>;
}
