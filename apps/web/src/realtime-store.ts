import { createContext, useContext } from 'react';
import type { Socket } from 'socket.io-client';

export type RealtimeContextValue = {
  socket: Socket | null;
  connected: boolean;
};

export const RealtimeContext = createContext<RealtimeContextValue>({ socket: null, connected: false });

export function useRealtime() {
  return useContext(RealtimeContext);
}