import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  configureNotifications,
  setNotificationToastHandler,
  syncNotificationPreferencesFromUser,
} from '../services/notificationService';

export default function NotificationBootstrap() {
  const { user } = useAuth();
  const { showToast } = useToast();

  useEffect(() => {
    configureNotifications().catch(() => {});
    setNotificationToastHandler(showToast);
  }, [showToast]);

  useEffect(() => {
    syncNotificationPreferencesFromUser(user);
  }, [user]);

  return null;
}
