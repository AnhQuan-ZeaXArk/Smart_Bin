import { useEffect, useState } from 'react';
import { socketService } from '../services/socket.service';
import { RealtimeConnectionStatus } from '../types/alert';

/**
 * Subscribes to the singleton socket status. Starts the shared connection only if it
 * has never been started (status 'disconnected'); it never creates a second socket.
 */
export function useRealtimeStatus(): RealtimeConnectionStatus {
  const [status, setStatus] = useState<RealtimeConnectionStatus>(socketService.getStatus());

  useEffect(() => {
    if (socketService.getStatus() === 'disconnected') {
      socketService.connect();
    }
    return socketService.onStatusChange(setStatus);
  }, []);

  return status;
}
