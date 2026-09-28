import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Check, Download } from 'lucide-react';

interface QRCodeDisplayProps {
  data: string;
  size?: number;
  label?: string;
}

export const QRCodeDisplay: React.FC<QRCodeDisplayProps> = ({
  data,
  size = 240,
  label,
}) => {
  const [dataUrl, setDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!data) return;

    QRCode.toDataURL(data, {
      width: size * 2, // 2x for retina crispness
      margin: 2,
      color: {
        dark: '#020617',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'L', // Low to keep code density manageable for camera scanning
    })
      .then((url) => {
        setDataUrl(url);
      })
      .catch((err) => {
        console.error('Error rendering QR code:', err);
      });
  }, [data, size]);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(data);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = data;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const downloadQR = () => {
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `meshchat-qr-${Date.now()}.png`;
    a.click();
  };

  return (
    <div className="flex flex-col items-center">
      {label && <p className="text-xs text-slate-400 mb-2">{label}</p>}

      {/* QR Code Container */}
      <div className="p-3 bg-white rounded-2xl shadow-xl flex items-center justify-center border-4 border-emerald-500/30">
        {dataUrl ? (
          <img
            src={dataUrl}
            alt="MeshChat QR Code"
            style={{ width: size, height: size }}
            className="rounded-lg object-contain"
          />
        ) : (
          <div
            style={{ width: size, height: size }}
            className="flex items-center justify-center text-slate-400 text-xs animate-pulse"
          >
            Generating QR Code...
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="mt-3 flex items-center gap-2 w-full max-w-[260px]">
        <button
          onClick={copyToClipboard}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 transition cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy Blob</span>
            </>
          )}
        </button>
        <button
          onClick={downloadQR}
          className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
          title="Download QR Image"
        >
          <Download className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
