import { clsx } from 'clsx';
import { useState } from 'react';
import {
  XMarkIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';
import type { StoryStatus, ShotStatus } from '../types/api';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  showCloseButton?: boolean;
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  showCloseButton = true,
}: ModalProps) {
  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-7xl',
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="flex min-h-full items-center justify-center p-4">
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/50 transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />

        {/* Modal Panel */}
        <div
          className={clsx(
            'relative w-full bg-white rounded-xl shadow-xl transform transition-all',
            sizeClasses[size]
          )}
        >
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
            <h2 id="modal-title" className="text-lg font-semibold text-gray-900">
              {title}
            </h2>
            {showCloseButton && (
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 transition p-1"
                aria-label="Close modal"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            )}
          </div>
          <div className="p-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary' | 'warning';
  isLoading?: boolean;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
  isLoading = false,
}: ConfirmDialogProps) {
  const variantStyles = {
    danger: 'btn-danger',
    primary: 'btn-primary',
    warning: 'bg-yellow-600 text-white hover:bg-yellow-700',
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <div className="space-y-4">
        <p className="text-gray-600">{message}</p>
        <div className="flex justify-end gap-3 pt-4">
          <button onClick={onClose} className="btn-secondary" disabled={isLoading}>
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={clsx(variantStyles[variant], 'px-4')}
            disabled={isLoading}
          >
            {isLoading ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

interface AlertDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
  type?: 'success' | 'error' | 'warning' | 'info';
  actionLabel?: string;
  onAction?: () => void;
}

export function AlertDialog({
  isOpen,
  onClose,
  title,
  message,
  type = 'info',
  actionLabel,
  onAction,
}: AlertDialogProps) {
  const typeStyles = {
    success: 'bg-green-50 border-green-200 text-green-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800',
  };

  const typeIcons = {
    success: CheckCircleIcon,
    error: ExclamationTriangleIcon,
    warning: ExclamationTriangleIcon,
    info: InformationCircleIcon,
  };

  const Icon = typeIcons[type];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <div className="space-y-4">
        <div className={clsx('flex gap-3 p-4 rounded-lg border', typeStyles[type])}>
          <Icon className="w-6 h-6 flex-shrink-0 mt-0.5" />
          <p className="text-gray-700">{message}</p>
        </div>
        <div className="flex justify-end gap-3">
          {actionLabel && onAction && (
            <button onClick={onAction} className="btn-primary">
              {actionLabel}
            </button>
          )}
          <button onClick={onClose} className="btn-secondary">
            OK
          </button>
        </div>
      </div>
    </Modal>
  );
}

interface FormDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: any) => void;
  title: string;
  children: React.ReactNode;
  submitLabel?: string;
  cancelLabel?: string;
  isLoading?: boolean;
}

export function FormDialog({
  isOpen,
  onClose,
  onSubmit,
  title,
  children,
  submitLabel = 'Save',
  cancelLabel = 'Cancel',
  isLoading = false,
}: FormDialogProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget as HTMLFormElement);
    const data = Object.fromEntries(formData.entries());
    onSubmit(data);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {children}
        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
          <button type="button" onClick={onClose} className="btn-secondary" disabled={isLoading}>
            {cancelLabel}
          </button>
          <button type="submit" className="btn-primary" disabled={isLoading}>
            {isLoading ? 'Saving...' : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default Modal;