import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, RefreshCw, Upload, X, AlertCircle } from 'lucide-react';

interface QRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (scannedText: string) => void;
  title?: string;
  description?: string;
}

export const QRScannerModal: React.FC<QRScannerModalProps> = ({
  isOpen,
  onClose,
  onScan,
  title = 'Scan QR Code',
  description = 'Align the QR code within the frame to scan automatically',
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [manualText, setManualText] = useState('');
  const [activeTab, setActiveTab] = useState<'camera' | 'paste' | 'upload'>('camera');
  const animationFrameRef = useRef<number | null>(null);

  // Start camera stream when open
  useEffect(() => {
    if (!isOpen || activeTab !== 'camera') {
      stopCamera();
      return;
    }

    let isMounted = true;

    async function startCamera() {
      setCameraError(null);
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });

        if (!isMounted) {
          mediaStream.getTracks().forEach((t) => t.stop());
          return;
        }

        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          videoRef.current.setAttribute('playsinline', 'true');
          await videoRef.current.play();
          startScanningLoop();
        }
      } catch (err: any) {
        console.error('Camera access error:', err);
        setCameraError(
          err.name === 'NotAllowedError'
            ? 'Camera permission was denied. You can paste the invite code or upload an image.'
            : 'Unable to start camera. Please paste the code or upload an image.'
        );
        setActiveTab('paste');
      }
    }

    startCamera();

    return () => {
      isMounted = false;
      stopCamera();
    };
  }, [isOpen, facingMode, activeTab]);

  const stopCamera = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const startScanningLoop = () => {
    const scan = () => {
      if (!videoRef.current || !canvasRef.current || videoRef.current.readyState !== videoRef.current.HAVE_ENOUGH_DATA) {
        animationFrameRef.current = requestAnimationFrame(scan);
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      if (ctx) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth',
        });

        if (code && code.data) {
          stopCamera();
          onScan(code.data);
          onClose();
          return;
        }
      }

      animationFrameRef.current = requestAnimationFrame(scan);
    };

    animationFrameRef.current = requestAnimationFrame(scan);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth',
        });
        if (code && code.data) {
          onScan(code.data);
          onClose();
        } else {
          setCameraError('No QR code detected in this image. Please try another image or paste text.');
        }
      }
    };
    img.src = URL.createObjectURL(file);
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualText.trim()) {
      onScan(manualText.trim());
      onClose();
    }
  };

  const toggleCamera = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-900/90">
          <div>
            <h3 className="text-base font-semibold text-slate-100">{title}</h3>
            <p className="text-xs text-slate-400 mt-0.5">{description}</p>
          </div>
          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-800 bg-slate-950/40 text-xs font-medium">
          <button
            onClick={() => setActiveTab('camera')}
            className={`flex-1 py-2.5 flex items-center justify-center gap-1.5 transition ${
              activeTab === 'camera'
                ? 'text-emerald-400 border-b-2 border-emerald-500 bg-slate-900'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Camera className="w-4 h-4" />
            <span>Camera</span>
          </button>
          <button
            onClick={() => setActiveTab('paste')}
            className={`flex-1 py-2.5 flex items-center justify-center gap-1.5 transition ${
              activeTab === 'paste'
                ? 'text-emerald-400 border-b-2 border-emerald-500 bg-slate-900'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>Paste Code</span>
          </button>
          <button
            onClick={() => setActiveTab('upload')}
            className={`flex-1 py-2.5 flex items-center justify-center gap-1.5 transition ${
              activeTab === 'upload'
                ? 'text-emerald-400 border-b-2 border-emerald-500 bg-slate-900'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Upload className="w-4 h-4" />
            <span>Upload Image</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="p-4 flex-1 flex flex-col justify-center items-center">
          {cameraError && (
            <div className="w-full mb-3 flex items-start gap-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{cameraError}</span>
            </div>
          )}

          {activeTab === 'camera' && (
            <div className="relative w-full aspect-square max-w-[320px] rounded-2xl overflow-hidden bg-black flex items-center justify-center border border-slate-800 shadow-inner">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                autoPlay
                playsInline
                muted
              />
              <canvas ref={canvasRef} className="hidden" />

              {/* Scanning visual overlay frame */}
              <div className="absolute inset-8 border-2 border-dashed border-emerald-400/80 rounded-xl pointer-events-none flex items-center justify-center">
                <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent animate-pulse" />
              </div>

              {/* Camera Switcher Button */}
              <button
                type="button"
                onClick={toggleCamera}
                className="absolute bottom-3 right-3 p-2.5 rounded-full bg-slate-900/80 hover:bg-slate-900 text-white backdrop-blur border border-slate-700 shadow-lg cursor-pointer"
                title="Switch Camera (Front/Back)"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          )}

          {activeTab === 'paste' && (
            <form onSubmit={handleManualSubmit} className="w-full space-y-3">
              <label className="block text-xs font-medium text-slate-300">
                Paste signaling invite or answer text:
              </label>
              <textarea
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                placeholder="MC1:... or JSON signaling data"
                rows={6}
                className="w-full rounded-xl bg-slate-950 border border-slate-800 p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 resize-none break-all"
                required
              />
              <button
                type="submit"
                disabled={!manualText.trim()}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium text-sm transition cursor-pointer shadow-lg shadow-emerald-900/20"
              >
                Submit Signaling Code
              </button>
            </form>
          )}

          {activeTab === 'upload' && (
            <div className="w-full py-6 flex flex-col items-center justify-center border-2 border-dashed border-slate-800 hover:border-slate-700 rounded-2xl bg-slate-950/30 p-6 text-center">
              <Upload className="w-10 h-10 text-emerald-400 mb-3" />
              <p className="text-sm font-medium text-slate-200">Select QR Code Image or Screenshot</p>
              <p className="text-xs text-slate-400 mt-1 mb-4">PNG, JPG, WebP supported</p>
              <label className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 cursor-pointer border border-slate-700 transition">
                Choose File
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
