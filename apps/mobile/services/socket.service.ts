import { io, Socket } from 'socket.io-client';
import { Config } from '../constants/config';
import { apiClient } from './api';
import { AlertItem, RealtimeConnectionStatus } from '../types/alert';

type StatusListener = (status: RealtimeConnectionStatus) => void;
type AlertListener = (alert: AlertItem) => void;
type AlertResolvedListener = (payload: { id?: string; alertId?: string; deviceId?: string }) => void;

/**
 * SmartBin Mobile Realtime Socket.IO Service
 * Singleton client managing lifecycle, authentication handshake,
 * and event subscriptions matching Backend RealtimeGateway contracts.
 */
class SocketService {
  private socket: Socket | null = null;
  private connectionStatus: RealtimeConnectionStatus = 'disconnected';
  private statusListeners = new Set<StatusListener>();
  private alertCreatedListeners = new Set<AlertListener>();
  private alertResolvedListeners = new Set<AlertResolvedListener>();
  private alertUpdatedListeners = new Set<AlertListener>();

  /**
   * Get current realtime connection status
   */
  public getStatus(): RealtimeConnectionStatus {
    return this.connectionStatus;
  }

  /**
   * Check if socket is currently connected
   */
  public isConnected(): boolean {
    return Boolean(this.socket?.connected);
  }

  private setStatus(status: RealtimeConnectionStatus) {
    if (this.connectionStatus === status) return;
    this.connectionStatus = status;
    this.statusListeners.forEach((listener) => {
      try {
        listener(status);
      } catch {
        // Suppress listener error
      }
    });
  }

  /**
   * Connect to backend Socket.IO server with JWT authentication
   */
  public connect(customToken?: string): void {
    const token = customToken || apiClient.getToken();
    if (!token) {
      this.setStatus('disconnected');
      return;
    }

    // If socket already connected with the same auth, reuse
    if (this.socket && this.socket.connected) {
      return;
    }

    // Clean up previous socket if existing
    if (this.socket) {
      this.socket.disconnect();
      this.socket.removeAllListeners();
      this.socket = null;
    }

    this.setStatus('connecting');

    try {
      this.socket = io(Config.apiUrl, {
        auth: { token },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 2000,
        timeout: 10000,
      });

      this.socket.on('connect', () => {
        this.setStatus('connected');
      });

      this.socket.on('disconnect', () => {
        this.setStatus('disconnected');
      });

      this.socket.on('connect_error', () => {
        this.setStatus('error');
      });

      this.socket.on('reconnect_attempt', () => {
        this.setStatus('reconnecting');
      });

      // Track recently processed alert IDs to avoid duplicate listener calls if backend fires dual events
      const processedAlertIds = new Set<string>();
      const handleNewAlert = (newAlert: AlertItem) => {
        if (!newAlert || !newAlert.id) return;
        if (processedAlertIds.has(newAlert.id)) return;
        processedAlertIds.add(newAlert.id);
        if (processedAlertIds.size > 100) {
          const first = processedAlertIds.values().next().value;
          if (first) processedAlertIds.delete(first);
        }
        this.alertCreatedListeners.forEach((listener) => listener(newAlert));
      };

      this.socket.on('alert:created', handleNewAlert);
      this.socket.on('alert', handleNewAlert);

      // Backend emits 'alert:resolved' when an alert is cleared
      this.socket.on(
        'alert:resolved',
        (resolved: { id?: string; alertId?: string; deviceId?: string }) => {
          this.alertResolvedListeners.forEach((listener) => listener(resolved));
        }
      );

      // Backend emits 'alert:updated' when an alert is updated
      this.socket.on('alert:updated', (updated: AlertItem) => {
        this.alertUpdatedListeners.forEach((listener) => listener(updated));
      });
    } catch {
      this.setStatus('error');
    }
  }

  /**
   * Disconnect socket and clear all state
   */
  public disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket.removeAllListeners();
      this.socket = null;
    }
    this.setStatus('disconnected');
    this.alertCreatedListeners.clear();
    this.alertResolvedListeners.clear();
    this.alertUpdatedListeners.clear();
  }

  /**
   * Subscribe to connection status changes
   */
  public onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.connectionStatus);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /**
   * Subscribe to new alert events
   */
  public onAlertCreated(listener: AlertListener): () => void {
    this.alertCreatedListeners.add(listener);
    return () => {
      this.alertCreatedListeners.delete(listener);
    };
  }

  /**
   * Subscribe to alert resolved events
   */
  public onAlertResolved(listener: AlertResolvedListener): () => void {
    this.alertResolvedListeners.add(listener);
    return () => {
      this.alertResolvedListeners.delete(listener);
    };
  }

  /**
   * Subscribe to alert updated events
   */
  public onAlertUpdated(listener: AlertListener): () => void {
    this.alertUpdatedListeners.add(listener);
    return () => {
      this.alertUpdatedListeners.delete(listener);
    };
  }
}

export const socketService = new SocketService();
