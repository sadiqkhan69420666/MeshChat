import React, { useEffect, useState } from 'react';
import { FileMetadata, FileDownloadProgress } from '../types';
import { fileManager } from '../services/files';
import { useApp } from '../context/AppContext';
import {
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  Download,
  CheckCircle,
  XCircle,
  AlertCircle,
  HardDrive,
  Eye,
} from 'lucide-react';

interface FileMessageBubbleProps {
  fileMeta: FileMetadata;
  isOutgoing?: boolean;
}

export const FileMessageBubble: React.FC<FileMessageBubbleProps> = ({
  fileMeta,
  isOutgoing,
}) => {
  const { mesh, showToast } = useApp();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [isComplete, setIsComplete] = useState<boolean>(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState<FileDownloadProgress | null>(null);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;

    // Check if already completed
    fileManager.isFileComplete(fileMeta.fileId).then((complete) => {
      if (!isMounted) return;
      setIsComplete(complete);
      if (complete) {
        fileManager.getFileBlobUrl(fileMeta.fileId).then((url) => {
          if (isMounted && url) setBlobUrl(url);
        });
      }
    });

    // Subscribe to progress if currently downloading
    const unsub = fileManager.subscribeProgress(fileMeta.fileId, (p) => {
      if (!isMounted) return;
      setProgress(p);
      if (p.isComplete) {
        setIsComplete(true);
        setIsDownloading(false);
        fileManager.getFileBlobUrl(fileMeta.fileId).then((url) => {
          if (isMounted && url) setBlobUrl(url);
        });
      }
    });

    return () => {
      isMounted = false;
      unsub();
    };
  }, [fileMeta.fileId]);

  const handleStartDownload = async () => {
    if (!mesh) {
      showToast('Mesh network not connected', 'warning');
      return;
    }
    setIsDownloading(true);
    try {
      await fileManager.startDownload(fileMeta, mesh);
      const url = await fileManager.getFileBlobUrl(fileMeta.fileId);
      if (url) setBlobUrl(url);
      setIsComplete(true);
      showToast(`Finished downloading ${fileMeta.name}`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Download error', 'warning');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleCancelDownload = () => {
    fileManager.cancelDownload(fileMeta.fileId);
    setIsDownloading(false);
    showToast('Download cancelled', 'info');
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const isImage = fileMeta.mimeType.startsWith('image/');
  const isAudio = fileMeta.mimeType.startsWith('audio/');
  const isVideo = fileMeta.mimeType.startsWith('video/');

  const pct =
    progress && progress.totalChunks > 0
      ? Math.round((progress.receivedChunks / progress.totalChunks) * 100)
      : isComplete
      ? 100
      : 0;

  return (
    <div className="w-full max-w-sm rounded-2xl overflow-hidden mt-1 bg-slate-900/90 border border-slate-700/60 shadow-md">
      {/* 1. Image Preview (when complete) */}
      {isComplete && isImage && blobUrl && (
        <div className="relative group cursor-pointer overflow-hidden max-h-60 bg-black/40 flex items-center justify-center">
          <img
            src={blobUrl}
            alt={fileMeta.name}
            className="w-full h-auto object-cover max-h-60 transition duration-300 group-hover:scale-105"
            onClick={() => setPreviewModalOpen(true)}
          />
          <div
            onClick={() => setPreviewModalOpen(true)}
            className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-1.5 text-white text-xs font-medium"
          >
            <Eye className="w-4 h-4" />
            <span>View Full Image</span>
          </div>
        </div>
      )}

      {/* 2. Video Player (when complete) */}
      {isComplete && isVideo && blobUrl && (
        <div className="bg-black/60 rounded-t-2xl overflow-hidden">
          <video src={blobUrl} controls className="w-full max-h-60" />
        </div>
      )}

      {/* 3. Audio Player (when complete) */}
      {isComplete && isAudio && blobUrl && (
        <div className="p-3 bg-slate-950/60 border-b border-slate-800">
          <audio src={blobUrl} controls className="w-full h-9" />
        </div>
      )}

      {/* Metadata & Controls Footer */}
      <div className="p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center flex-shrink-0 text-slate-300">
              {isImage ? (
                <ImageIcon className="w-4 h-4 text-emerald-400" />
              ) : isVideo ? (
                <Film className="w-4 h-4 text-cyan-400" />
              ) : isAudio ? (
                <Music className="w-4 h-4 text-purple-400" />
              ) : (
                <FileText className="w-4 h-4 text-amber-400" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-100 truncate" title={fileMeta.name}>
                {fileMeta.name}
              </p>
              <p className="text-[11px] text-slate-400">
                {formatBytes(fileMeta.size)} • {fileMeta.chunkCount} chunks
              </p>
            </div>
          </div>

          {/* Action Button */}
          {isComplete && blobUrl ? (
            <a
              href={blobUrl}
              download={fileMeta.name}
              className="p-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 transition flex-shrink-0"
              title="Save to Device"
            >
              <Download className="w-4 h-4" />
            </a>
          ) : isDownloading ? (
            <button
              onClick={handleCancelDownload}
              className="p-2 rounded-xl bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 border border-rose-500/30 transition flex-shrink-0 cursor-pointer"
              title="Cancel Swarm"
            >
              <XCircle className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleStartDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow transition cursor-pointer flex-shrink-0"
              title="Download chunks from mesh peers"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Get</span>
            </button>
          )}
        </div>

        {/* Progress Bar (when downloading) */}
        {isDownloading && (
          <div className="mt-2.5">
            <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
              <span>Swarming chunks...</span>
              <span className="font-semibold text-emerald-400">{pct}%</span>
            </div>
            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-cyan-500 transition-all duration-200"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Fullscreen Image Preview Lightbox */}
      {previewModalOpen && blobUrl && (
        <div
          onClick={() => setPreviewModalOpen(false)}
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 cursor-pointer animate-in fade-in"
        >
          <img
            src={blobUrl}
            alt={fileMeta.name}
            className="max-w-full max-h-[90vh] object-contain rounded-xl shadow-2xl"
          />
        </div>
      )}
    </div>
  );
};
