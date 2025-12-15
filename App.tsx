import React, { useEffect, useRef, useState } from 'react';
import { Experience } from './components/Experience.tsx';
import { geminiService } from './services/geminiService.ts';
import { GestureData, TreeState } from './types.ts';

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hasPermission, setHasPermission] = useState(false);
  const [apiKeyMissing, setApiKeyMissing] = useState(false);
  
  // Store uploaded image Data URLs
  const [customPhotos, setCustomPhotos] = useState<string[]>([]);
  
  const [gestureData, setGestureData] = useState<GestureData>({
    state: TreeState.FORMED,
    handX: 0,
    handY: 0
  });

  useEffect(() => {
    // Check global process env polyfill
    if (!process.env.API_KEY) {
      setApiKeyMissing(true);
    }

    const startWebcam = async () => {
      // Allow running without API key for visual testing
      // if (!process.env.API_KEY) return;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                width: { ideal: 640 },
                height: { ideal: 480 } 
            } 
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play();
            setHasPermission(true);
            
            // Only connect Gemini if API key exists
            if (process.env.API_KEY) {
                geminiService.connect(videoRef.current!, (data) => {
                  setGestureData(prev => {
                    const newState = data.state === TreeState.CHAOS ? TreeState.CHAOS : prev.state;
                    return {
                      state: newState,
                      handX: data.handX,
                      handY: data.handY
                    };
                  });
                });
            }
          };
        }
      } catch (err) {
        console.error("Error accessing webcam:", err);
      }
    };

    startWebcam();

    return () => {
      geminiService.disconnect();
    };
  }, []);

  const toggleSimulation = () => {
    setGestureData(prev => ({
      ...prev,
      state: prev.state === TreeState.FORMED ? TreeState.CHAOS : TreeState.FORMED
    }));
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    const promises = fileList.map(file => {
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.readAsDataURL(file as Blob);
      });
    });

    try {
      const images = await Promise.all(promises);
      setCustomPhotos(images);
    } catch (error) {
      console.error("Error reading files:", error);
    }
  };

  return (
    <div className="relative w-full h-screen bg-black">
      {/* 3D Scene */}
      <div className="absolute inset-0 z-0">
        <Experience gestureData={gestureData} customPhotos={customPhotos} />
      </div>

      {/* Hidden Input for File Upload */}
      <input 
        type="file" 
        ref={fileInputRef} 
        className="hidden" 
        multiple 
        accept="image/*" 
        onChange={handleFileChange}
      />

      {/* UI Overlay */}
      <div className="absolute inset-0 pointer-events-none z-10 flex flex-col justify-between p-8">
        <header className="flex flex-col items-center">
          <h1 className="text-5xl font-bold tracking-widest uppercase font-serif gold-text drop-shadow-lg text-center">
            CHRISTMAS GIVEAWAY!
          </h1>
          <p className="text-white/70 text-sm mt-2 font-serif italic tracking-wider">
            WIN a Jovikid iSize Car Seat!
          </p>
        </header>

        <div className="flex justify-between items-end">
          {/* Status & Controls */}
          <div className="flex flex-col gap-4 pointer-events-auto">
            {/* Status Panel */}
            <div className="bg-black/40 backdrop-blur-md border border-[#C0C0C0]/30 p-4 rounded-lg text-white font-mono text-xs w-64">
              <h3 className="text-[#FFD700] mb-2 uppercase border-b border-[#FFD700]/30 pb-1">System Status</h3>
              <div className="flex justify-between mb-1">
                <span>MODE:</span>
                <span className={gestureData.state === TreeState.CHAOS ? "text-red-400 font-bold" : "text-green-400 font-bold"}>
                  {gestureData.state}
                </span>
              </div>
              <div className="flex justify-between mb-1">
                <span>HAND X:</span>
                <span>{gestureData.handX.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>HAND Y:</span>
                <span>{gestureData.handY.toFixed(2)}</span>
              </div>
              {apiKeyMissing && (
                  <div className="mt-2 text-red-500 font-bold border-t border-red-500 pt-1">
                      API KEY MISSING (Check index.html)
                  </div>
              )}
            </div>

            {/* Manual Controls */}
            <div className="flex gap-2">
              <button 
                onClick={toggleSimulation}
                className="bg-black/60 backdrop-blur-md border border-[#FFD700] text-[#FFD700] px-4 py-3 rounded-lg font-serif tracking-widest hover:bg-[#FFD700]/20 active:bg-[#FFD700]/40 transition-all uppercase text-xs flex items-center justify-center gap-2 group"
              >
                <span className="w-2 h-2 rounded-full bg-[#FFD700] group-hover:animate-pulse"></span>
                {gestureData.state === TreeState.FORMED ? 'Simulate Unleash' : 'Restore Tree'}
              </button>

              <button 
                onClick={handleUploadClick}
                className="bg-black/60 backdrop-blur-md border border-[#C0C0C0] text-[#C0C0C0] px-4 py-3 rounded-lg font-serif tracking-widest hover:bg-[#C0C0C0]/20 active:bg-[#C0C0C0]/40 transition-all uppercase text-xs flex items-center justify-center gap-2"
              >
                Upload Photos
              </button>
            </div>
          </div>

          {/* Webcam Preview (Small) */}
          <div className="relative group pointer-events-auto">
            <video 
              ref={videoRef} 
              className="w-48 h-36 object-cover rounded-lg border-2 border-[#FFD700] opacity-50 hover:opacity-100 transition-opacity" 
              muted 
              playsInline 
            />
            {!hasPermission && !apiKeyMissing && (
              <div className="absolute inset-0 flex items-center justify-center text-white text-xs text-center bg-black/50">
                Awaiting Camera Access...
              </div>
            )}
            <div className="absolute -top-10 right-0 bg-black/60 text-white text-xs px-2 py-1 rounded">
                Show <span className="text-[#FFD700]">Open Hand</span> to Unleash<br/>
                Click Button to Restore
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;