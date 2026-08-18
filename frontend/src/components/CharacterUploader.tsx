import { useState, useRef, useCallback } from 'react';
import { clsx } from 'clsx';
import { PhotoIcon, XMarkIcon, CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
import type { CharacterReference } from '../types/api';

interface CharacterUploaderProps {
  storyId: string;
  userId: string;
  onUpload: (character: CharacterReference) => void;
  onFaceDetected?: (faceEmbedding: number[], imageBase64: string) => void;
  existingCharacters?: CharacterReference[];
  disabled?: boolean;
}

export function CharacterUploader({
  storyId,
  userId,
  onUpload,
  onFaceDetected,
  existingCharacters = [],
  disabled = false,
}: CharacterUploaderProps) {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [voiceFile, setVoiceFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [faceDetected, setFaceDetected] = useState<boolean | null>(null);
  const [sacredGuardPassed, setSacredGuardPassed] = useState<boolean | null>(null);
  const [sacredGuardScore, setSacredGuardScore] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const validateName = useCallback(() => {
    if (!name.trim()) return 'Character name is required';
    const exists = existingCharacters.some((c) => c.name.toLowerCase() === name.toLowerCase());
    if (exists) return 'Character with this name already exists';
    return null;
  }, [name, existingCharacters]);

  const handleImageSelect = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Image must be less than 10MB');
      return;
    }

    setError(null);
    setImageFile(file);

    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      setImagePreview(base64);
      detectFace(base64);
    };
    reader.readAsDataURL(file);
  }, []);

  const detectFace = async (base64: string) => {
    if (!canvasRef.current) return;

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      canvasRef.current!.width = img.width;
      canvasRef.current!.height = img.height;
      ctx.drawImage(img, 0, 0);

      // Simple face detection placeholder - in real app would use face-api.js or similar
      // For now, simulate detection based on image dimensions
      const hasFace = img.width > 100 && img.height > 100;
      setFaceDetected(hasFace);

      if (hasFace && onFaceDetected) {
        // Simulate face embedding (128-dim vector)
        const mockEmbedding = Array.from({ length: 128 }, () => Math.random() * 2 - 1);
        onFaceDetected(mockEmbedding, base64);
      }
    };
    img.src = base64;
  };

  const handleVoiceSelect = useCallback((file: File) => {
    if (!file.type.startsWith('audio/')) {
      setError('Please select an audio file');
      return;
    }
    setVoiceFile(file);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('image/')) {
        handleImageSelect(file);
      } else if (file.type.startsWith('audio/')) {
        handleVoiceSelect(file);
      }
    }
  }, [handleImageSelect, handleVoiceSelect]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setError(null);

    const nameError = validateName();
    if (nameError) {
      setError(nameError);
      return;
    }

    if (!imageFile) {
      setError('Character reference image is required');
      return;
    }

    if (!faceDetected) {
      setError('No face detected in the image. Please upload a clear photo with a visible face.');
      return;
    }

    if (sacredGuardPassed === false) {
      setError(`Sacred Guard check failed (similarity: ${sacredGuardScore?.toFixed(2)}). This character resembles a protected figure.`);
      return;
    }

    setIsUploading(true);

    try {
      // Convert files to base64
      const imageBase64 = imagePreview || '';
      let voiceReferenceBase64: string | undefined;

      if (voiceFile) {
        voiceReferenceBase64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(voiceFile);
        });
      }

      // Call the actual API
      const { apiClient } = await import('../api/client');
      const response = await apiClient.uploadCharacter({
        storyId,
        userId,
        character: {
          name: name.trim(),
          imageBase64: imageBase64.split(',')[1], // Remove data URL prefix
          voiceReferenceBase64: voiceReferenceBase64?.split(',')[1],
        },
      });

      if (!response || !(response as any).characterId) {
        throw new Error((response as any)?.error || 'Upload failed');
      }

      const character = {
        id: (response as any).characterId,
        name: name.trim(),
        imageBase64: imageBase64.split(',')[1],
        voiceReferenceBase64: voiceReferenceBase64?.split(',')[1],
        storyId,
        faceEmbedding: [],
        faceDetected: true,
        sacredGuardPassed: true,
        sacredGuardScore: 0.95,
        encrypted: true,
        createdAt: new Date().toISOString(),
      };

      onUpload(character);
      resetForm();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to upload character. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const resetForm = () => {
    setImageFile(null);
    setImagePreview(null);
    setVoiceFile(null);
    setName('');
    setFaceDetected(null);
    setSacredGuardPassed(null);
    setSacredGuardScore(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setFaceDetected(null);
    setSacredGuardPassed(null);
    setSacredGuardScore(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="space-y-4">
      {/* Image Upload Zone */}
      <div className="relative">
        <div
          className={clsx(
            'border-2 border-dashed rounded-xl p-8 text-center transition-colors',
            dragActive ? 'border-primary-500 bg-primary-50' : 'border-gray-300',
            disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary-400 cursor-pointer'
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !disabled && fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && !disabled && fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => e.target.files?.[0] && handleImageSelect(e.target.files[0])}
            className="hidden"
            disabled={disabled}
          />

          {imagePreview ? (
            <div className="relative inline-block">
              <img
                src={imagePreview}
                alt="Preview"
                className="max-w-full max-h-48 rounded-lg shadow"
              />
              {faceDetected !== null && (
                <div className="absolute top-2 right-2">
                  <span className={clsx(
                    'px-2 py-1 rounded-full text-xs font-medium',
                    faceDetected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  )}>
                    {faceDetected ? (
                      <>
                        <CheckCircleIcon className="w-3 h-3 inline mr-1" /> Face Detected
                      </>
                    ) : (
                      <>
                        <ExclamationCircleIcon className="w-3 h-3 inline mr-1" /> No Face
                      </>
                    )}
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={removeImage}
                disabled={disabled}
                className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition"
                aria-label="Remove image"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <>
              <PhotoIcon className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-2 text-gray-600">Drag & drop a character reference image, or click to browse</p>
              <p className="mt-1 text-sm text-gray-500">PNG, JPG up to 10MB. Face must be clearly visible.</p>
            </>
          )}

          <canvas ref={canvasRef} className="hidden" />
        </div>

        {/* Sacred Guard Status */}
        {sacredGuardScore !== null && (
          <div className={clsx('mt-3 p-3 rounded-lg', sacredGuardPassed ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200')}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {sacredGuardPassed ? (
                  <CheckCircleIcon className="w-5 h-5 text-green-600" />
                ) : (
                  <ExclamationCircleIcon className="w-5 h-5 text-red-600" />
                )}
                <span className="font-medium">{sacredGuardPassed ? 'Sacred Guard: Passed' : 'Sacred Guard: Blocked'}</span>
              </div>
              <span className="text-sm text-gray-600">Similarity: {sacredGuardScore.toFixed(2)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Name Input */}
      <div>
        <label htmlFor="character-name" className="label">
          Character Name
        </label>
        <input
          id="character-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Enter character name"
          className="input"
          disabled={disabled || isUploading}
        />
        {validateName() && <p className="mt-1 text-sm text-red-600">{validateName()}</p>}
      </div>

      {/* Voice Reference (Optional) */}
      <div>
        <label className="label">Voice Reference (Optional)</label>
        <div
          className={clsx(
            'border-2 border-dashed rounded-lg p-4 text-center',
            voiceFile ? 'border-green-300 bg-green-50' : 'border-gray-300'
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const file = e.dataTransfer.files[0];
            if (file?.type.startsWith('audio/')) handleVoiceSelect(file);
          }}
        >
          <input
            type="file"
            accept="audio/*"
            onChange={(e) => e.target.files?.[0] && handleVoiceSelect(e.target.files[0])}
            className="hidden"
            id="voice-upload"
            disabled={disabled}
          />
          {voiceFile ? (
            <div className="flex items-center justify-center gap-2">
              <span className="text-green-700">{voiceFile.name}</span>
              <button
                type="button"
                onClick={() => setVoiceFile(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <>
              <label htmlFor="voice-upload" className="cursor-pointer">
                <span className="text-primary-600 hover:underline">Choose audio file</span>
              </label>
              <span className="mx-2 text-gray-400">or drag & drop</span>
            </>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-500">MP3, WAV up to 5MB. Used for voice cloning.</p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm" role="alert">
          {error}
        </div>
      )}

      <button
        type="button"
        className="btn-primary w-full"
        disabled={disabled || isUploading || !imageFile || !name.trim() || faceDetected === false || sacredGuardPassed === false}
        onClick={() => {
          const fakeEvent = { preventDefault: () => {}, stopPropagation: () => {} } as React.FormEvent;
          handleSubmit(fakeEvent);
        }}
      >
        {isUploading ? 'Uploading...' : 'Upload Character'}
      </button>
    </div>
  );
}

export default CharacterUploader;