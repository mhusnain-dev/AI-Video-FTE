import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  InformationCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { clsx } from 'clsx';
import { useNotifications } from '../store/uiStore';

const ICONS = {
  success: CheckCircleIcon,
  error: XCircleIcon,
  warning: ExclamationTriangleIcon,
  info: InformationCircleIcon,
};

const STYLES = {
  success: 'bg-white border-green-200 text-green-800',
  error: 'bg-white border-red-200 text-red-800',
  warning: 'bg-white border-yellow-200 text-yellow-800',
  info: 'bg-white border-blue-200 text-blue-800',
};

const ICON_COLORS = {
  success: 'text-green-500',
  error: 'text-red-500',
  warning: 'text-yellow-500',
  info: 'text-blue-500',
};

export function NotificationContainer() {
  const { notifications, removeNotification } = useNotifications();

  if (notifications.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {notifications.map((notification) => {
        const Icon = ICONS[notification.type];
        return (
          <div
            key={notification.id}
            className={clsx(
              'pointer-events-auto flex items-start gap-3 p-4 rounded-lg border shadow-lg animate-in slide-in-from-right',
              STYLES[notification.type]
            )}
            role="alert"
          >
            <Icon className={clsx('w-5 h-5 flex-shrink-0 mt-0.5', ICON_COLORS[notification.type])} />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900">{notification.title}</p>
              {notification.message && <p className="text-sm text-gray-600 mt-0.5">{notification.message}</p>}
              {notification.action && (
                <button
                  onClick={notification.action.onClick}
                  className="text-sm font-medium text-primary-600 hover:text-primary-700 mt-2"
                >
                  {notification.action.label}
                </button>
              )}
            </div>
            <button
              onClick={() => removeNotification(notification.id)}
              className="flex-shrink-0 text-gray-400 hover:text-gray-600"
              aria-label="Dismiss"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default NotificationContainer;