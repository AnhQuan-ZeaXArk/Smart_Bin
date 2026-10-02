import { useEffect, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { RealtimeContext } from './realtime-store';

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export function RealtimeProvider({ token, children }: { token: string | null; children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!token) return;

    const realtime = io(apiUrl, {
      auth: { token },
      transports: ['websocket', 'polling']
    });
    queueMicrotask(() => setSocket(realtime));
    realtime.on('connect', () => setConnected(true));
    realtime.on('disconnect', () => setConnected(false));
    realtime.on('connect_error', () => setConnected(false));

    return () => {
      realtime.disconnect();
      queueMicrotask(() => setSocket((current) => current === realtime ? null : current));
    };
  }, [token]);

  return <RealtimeContext.Provider value={{ socket, connected }}>{children}</RealtimeContext.Provider>;
}