import React, { useEffect, useRef, useState, useMemo, useLayoutEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Stars, PerspectiveCamera, Image } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { GoogleGenAI, Modality } from '@google/genai';

// --- 1. TYPES ---
enum TreeState {
  CHAOS = 'CHAOS',
  FORMED = 'FORMED'
}

interface GestureData {
  state: TreeState;
  handX: number;
  handY: number;
}

// --- 2. CONSTANTS ---
const COLORS = {
  EMERALD: new THREE.Color('#004225'),
  GOLD: new THREE.Color('#FFD700'),
  SILVER: new THREE.Color('#C0C0C0'),
  RIBBON_RED: new THREE.Color('#8B0000'),
  GLOW: new THREE.Color('#FFECB3'),
};

const TREE_HEIGHT = 12; 
const TREE_RADIUS_BASE = 5.0;
const CHAOS_RADIUS = 35;

const FOLIAGE_COUNT = 15000;
const ORNAMENT_COUNT = 400;
const FILLER_COUNT = 1200;
const POLAROID_COUNT = 30;

const CAMERA_POS = new THREE.Vector3(0, 3, 20);

// --- 3. SERVICES ---
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64data = reader.result as string;
      resolve(base64data.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

class GeminiLiveService {
  private session: any = null;
  private intervalId: number | null = null;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private ai: GoogleGenAI | null = null;
  private isFallbackActive = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
  }

  async connect(videoElement: HTMLVideoElement, onData: (data: GestureData) => void): Promise<void> {
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      console.warn("No API Key found. Gesture control disabled.");
      return;
    }

    this.ai = new GoogleGenAI({ apiKey });
    this.isFallbackActive = false;

    const systemInstruction = `
    You are a visual control system for an interactive art installation.
    Analyze the video stream (or image) of the user.
    1. Detect if the user's hand is OPEN (fingers spread) or CLOSED (fist).
    2. OPEN hand means "UNLEASH" (Chaos). CLOSED hand means "FORM" (Tree).
    3. Calculate the approximate centroid of the hand in the frame.
       Map X from -1 (left) to 1 (right).
       Map Y from -1 (bottom) to 1 (top).
    Output ONLY valid JSON.
    Format: { "state": "CHAOS" | "FORMED", "x": number, "y": number }
    If no hand is detected, default to { "state": "FORMED", "x": 0, "y": 0 }.
    `;

    try {
      this.session = await this.ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.TEXT],
          systemInstruction: systemInstruction,
        },
        callbacks: {
          onopen: () => {
            console.log("Gemini Live Connected");
            this.startStreamingLive(videoElement, onData);
          },
          onmessage: (msg: any) => {
            if (msg.serverContent?.modelTurn?.parts) {
              for (const part of msg.serverContent.modelTurn.parts) {
                if (part.text) {
                  try {
                    const match = part.text.match(/\{.*\}/);
                    if (match) {
                      const json = JSON.parse(match[0]);
                      onData({
                        state: json.state === 'CHAOS' ? TreeState.CHAOS : TreeState.FORMED,
                        handX: typeof json.x === 'number' ? json.x : 0,
                        handY: typeof json.y === 'number' ? json.y : 0,
                      });
                    }
                  } catch (e) {}
                }
              }
            }
          },
          onclose: () => console.log("Gemini Live Closed"),
          onerror: (e: any) => {
            console.warn("Gemini Live Error, switching to fallback...", e);
            this.switchToFallback(videoElement, onData, systemInstruction);
          },
        },
      });
    } catch (error) {
      console.warn("Gemini Live Connection Failed. Fallback.", error);
      this.switchToFallback(videoElement, onData, systemInstruction);
    }
  }

  private switchToFallback(videoElement: HTMLVideoElement, onData: (data: GestureData) => void, instruction: string) {
    if (this.isFallbackActive) return;
    this.isFallbackActive = true;
    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; }
    if (this.session) { try { this.session.close(); } catch(e) {} this.session = null; }
    this.startPollingFallback(videoElement, onData, instruction);
  }

  private startStreamingLive(videoEl: HTMLVideoElement, onData: any) {
    this.intervalId = window.setInterval(async () => {
      if (this.isFallbackActive || !this.session || !this.ctx || !videoEl.videoWidth) return;
      this.canvas.width = videoEl.videoWidth / 4; 
      this.canvas.height = videoEl.videoHeight / 4;
      this.ctx.drawImage(videoEl, 0, 0, this.canvas.width, this.canvas.height);
      this.canvas.toBlob(async (blob) => {
        if (blob && this.session && !this.isFallbackActive) {
          const base64 = await blobToBase64(blob);
          try {
              this.session.sendRealtimeInput({ media: { mimeType: 'image/jpeg', data: base64 } });
          } catch(e) {}
        }
      }, 'image/jpeg', 0.5);
    }, 800); 
  }

  private startPollingFallback(videoEl: HTMLVideoElement, onData: (data: GestureData) => void, systemInstruction: string) {
    this.intervalId = window.setInterval(async () => {
      if (!this.ai || !this.ctx || !videoEl.videoWidth) return;
      this.canvas.width = videoEl.videoWidth / 4;
      this.canvas.height = videoEl.videoHeight / 4;
      this.ctx.drawImage(videoEl, 0, 0, this.canvas.width, this.canvas.height);
      const base64Data = this.canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
      try {
        const response = await this.ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: base64Data } }, { text: "Analyze hand state. Return JSON only." }] }],
          config: { systemInstruction: systemInstruction, responseMimeType: 'application/json' }
        });
        if (response.text) {
          const json = JSON.parse(response.text);
          onData({
            state: json.state === 'CHAOS' ? TreeState.CHAOS : TreeState.FORMED,
            handX: typeof json.x === 'number' ? json.x : 0,
            handY: typeof json.y === 'number' ? json.y : 0,
          });
        }
      } catch (e) { console.error("Fallback error", e); }
    }, 1500);
  }

  disconnect() {
    this.isFallbackActive = false;
    if (this.intervalId) clearInterval(this.intervalId);
    if(this.session) { try { this.session.close(); } catch(e) {} }
    this.session = null;
    this.ai = null;
  }
}
const geminiService = new GeminiLiveService();

// --- 4. COMPONENTS ---

// 4.1 FOLIAGE
const FoliageShaderMaterial = {
  uniforms: {
    uTime: { value: 0 },
    uProgress: { value: 0 },
    uColorBase: { value: COLORS.EMERALD },
    uColorTip: { value: new THREE.Color('#2E8B57') },
    uGold: { value: COLORS.GOLD },
  },
  vertexShader: `
    uniform float uTime;
    uniform float uProgress;
    attribute vec3 aTargetPos;
    attribute vec3 aChaosPos;
    attribute float aRandom;
    varying vec2 vUv;
    varying float vRandom;
    void main() {
      vUv = uv;
      vRandom = aRandom;
      vec3 pos = mix(aTargetPos, aChaosPos, uProgress);
      float wind = sin(uTime * 2.0 + aRandom * 10.0) * 0.1;
      pos.x += wind;
      vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
      gl_PointSize = (4.0 * (1.0 + uProgress * 2.0)) * (20.0 / -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    uniform vec3 uColorBase;
    uniform vec3 uColorTip;
    uniform vec3 uGold;
    uniform float uProgress;
    varying float vRandom;
    void main() {
      vec2 xy = gl_PointCoord.xy - vec2(0.5);
      if(length(xy) > 0.5) discard;
      vec3 color = mix(uColorBase, uColorTip, vRandom);
      if (vRandom > 0.9) color = mix(color, uGold, 0.8);
      float sparkle = sin(vRandom * 100.0) > 0.95 ? 1.0 : 0.0;
      color += sparkle * uProgress * uGold;
      gl_FragColor = vec4(color, 1.0);
    }
  `
};

const Foliage: React.FC<{ progress: number }> = ({ progress }) => {
  const shaderRef = useRef<THREE.ShaderMaterial>(null);
  const { positions, chaosPositions, randoms } = useMemo(() => {
    const pos = new Float32Array(FOLIAGE_COUNT * 3);
    const chaos = new Float32Array(FOLIAGE_COUNT * 3);
    const rands = new Float32Array(FOLIAGE_COUNT);
    for (let i = 0; i < FOLIAGE_COUNT; i++) {
      const h = Math.random() * TREE_HEIGHT;
      const r = Math.sqrt(Math.random()) * (TREE_RADIUS_BASE * (1 - h / TREE_HEIGHT));
      const theta = Math.random() * Math.PI * 2 * 10;
      pos[i*3] = r * Math.cos(theta); pos[i*3+1] = h; pos[i*3+2] = r * Math.sin(theta);
      
      const u = Math.random(), v = Math.random();
      const theta2 = 2 * Math.PI * u, phi = Math.acos(2 * v - 1), r2 = Math.cbrt(Math.random()) * CHAOS_RADIUS;
      chaos[i*3] = r2 * Math.sin(phi) * Math.cos(theta2);
      chaos[i*3+1] = r2 * Math.sin(phi) * Math.sin(theta2) + 10;
      chaos[i*3+2] = r2 * Math.cos(phi);
      rands[i] = Math.random();
    }
    return { positions: pos, chaosPositions: chaos, randoms: rands };
  }, []);

  useFrame((state) => {
    if (shaderRef.current) {
      shaderRef.current.uniforms.uTime.value = state.clock.elapsedTime;
      shaderRef.current.uniforms.uProgress.value = THREE.MathUtils.lerp(shaderRef.current.uniforms.uProgress.value, progress, 0.1);
    }
  });

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={FOLIAGE_COUNT} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-aTargetPos" count={FOLIAGE_COUNT} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-aChaosPos" count={FOLIAGE_COUNT} array={chaosPositions} itemSize={3} />
        <bufferAttribute attach="attributes-aRandom" count={FOLIAGE_COUNT} array={randoms} itemSize={1} />
      </bufferGeometry>
      <shaderMaterial ref={shaderRef} args={[FoliageShaderMaterial]} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
};

// 4.2 ORNAMENTS
const Ornaments: React.FC<{ progress: number }> = ({ progress }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const tempObject = new THREE.Object3D();
  
  const data = useMemo(() => {
    return Array.from({ length: ORNAMENT_COUNT }).map((_, i) => {
      const h = Math.random() * (TREE_HEIGHT - 1) + 1;
      const r = (TREE_RADIUS_BASE * (1 - h/TREE_HEIGHT)) * (0.8 + Math.random() * 0.4);
      const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(r * Math.cos(theta), h, r * Math.sin(theta));

      const u = Math.random(), v = Math.random();
      const theta2 = 2 * Math.PI * u, phi = Math.acos(2 * v - 1), r2 = Math.cbrt(Math.random()) * CHAOS_RADIUS;
      const chaosPos = new THREE.Vector3(r2 * Math.sin(phi)*Math.cos(theta2), r2*Math.sin(phi)*Math.sin(theta2)+10, r2*Math.cos(phi));
      
      const type = Math.random() > 0.7 ? 'GIFT' : 'BALL';
      const color = type === 'GIFT' ? (Math.random()>0.5 ? COLORS.RIBBON_RED : COLORS.GOLD) : (Math.random()>0.5 ? COLORS.GOLD : COLORS.SILVER);
      return { targetPos, chaosPos, scale: Math.random()*0.4+0.2, color, speed: Math.random()*0.05+0.02, currentPos: chaosPos.clone() };
    });
  }, []);

  useLayoutEffect(() => {
    if (meshRef.current) {
        data.forEach((d, i) => {
            tempObject.position.copy(d.targetPos);
            tempObject.scale.setScalar(d.scale);
            tempObject.updateMatrix();
            meshRef.current!.setMatrixAt(i, tempObject.matrix);
            meshRef.current!.setColorAt(i, d.color);
        });
        meshRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [data]);

  useFrame(() => {
    if (!meshRef.current) return;
    data.forEach((d, i) => {
      const dest = progress > 0.5 ? d.chaosPos : d.targetPos;
      d.currentPos.lerp(dest, d.speed);
      if (progress > 0.5) d.currentPos.y += Math.sin(Date.now() * 0.001 + i) * 0.02;
      tempObject.position.copy(d.currentPos);
      tempObject.rotation.x += 0.01; tempObject.rotation.y += 0.01;
      tempObject.scale.setScalar(d.scale);
      tempObject.updateMatrix();
      meshRef.current!.setMatrixAt(i, tempObject.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, ORNAMENT_COUNT]}>
      <sphereGeometry args={[1, 16, 16]} />
      <meshStandardMaterial roughness={0.1} metalness={0.9} emissive={COLORS.GOLD} emissiveIntensity={0.2} />
    </instancedMesh>
  );
};

// 4.3 POLAROIDS
const PolaroidItem: React.FC<{ url: string; index: number; progress: number; total: number }> = ({ url, index, progress, total }) => {
    const groupRef = useRef<THREE.Group>(null);
    const { targetPos, galleryPos, speed } = useMemo(() => {
        const h = Math.random() * (TREE_HEIGHT - 2) + 1.5; 
        const r = (TREE_RADIUS_BASE * (1 - h/TREE_HEIGHT)) + 0.6; 
        const theta = Math.random() * Math.PI * 2;
        const targetPos = new THREE.Vector3(r * Math.cos(theta), h, r * Math.sin(theta));
        
        const cols = 6;
        const rows = Math.ceil(total / cols);
        const col = index % cols;
        const row = Math.floor(index / cols);
        const galleryPos = new THREE.Vector3((col * 2.5) - ((cols-1)*2.5 / 2), (row * 3.0) - ((rows-1)*3.0 / 2) + 3, 14);
        return { targetPos, galleryPos, speed: 0.03 + Math.random() * 0.02 };
    }, [index, total]);

    useFrame((state) => {
        if (!groupRef.current) return;
        const dest = progress > 0.5 ? galleryPos : targetPos;
        groupRef.current.position.lerp(dest, speed);
        if (progress > 0.5) {
            groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, 0, 0.1);
            groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, 0, 0.1);
            groupRef.current.rotation.z = THREE.MathUtils.lerp(groupRef.current.rotation.z, 0, 0.1);
        } else {
             const angleToCenter = Math.atan2(groupRef.current.position.x, groupRef.current.position.z);
             const sway = Math.sin(state.clock.elapsedTime * 2 + index) * 0.1;
             groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, sway, 0.1); 
             groupRef.current.rotation.z = THREE.MathUtils.lerp(groupRef.current.rotation.z, sway * 0.5, 0.1); 
             groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, angleToCenter, 0.1);
        }
    });

    return (
        <group ref={groupRef}>
            <group>
                <mesh position={[0, 0, -0.01]}>
                    <boxGeometry args={[1.3, 1.3, 0.05]} />
                    <meshStandardMaterial color="#FF8C00" roughness={0.4} metalness={0.2} />
                </mesh>
                <Image url={url} scale={[1.1, 1.1]} position={[0, 0, 0.03]} transparent />
            </group>
        </group>
    );
}

const Polaroids: React.FC<{ progress: number; photos: string[] }> = ({ progress, photos }) => {
    const images = useMemo(() => {
        if (photos && photos.length > 0) return photos;
        return Array.from({ length: POLAROID_COUNT }).map((_, i) => `https://picsum.photos/300/300?random=${i}`);
    }, [photos]);

    return (
        <group>
            {Array.from({ length: POLAROID_COUNT }).map((_, i) => (
                <PolaroidItem key={`${i}-${images[i % images.length]}`} index={i} url={images[i % images.length]} progress={progress} total={POLAROID_COUNT} />
            ))}
        </group>
    );
};

// 4.4 FILLERS
const Fillers: React.FC<{ progress: number }> = ({ progress }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const tempObject = new THREE.Object3D();
  
  const data = useMemo(() => {
    return Array.from({ length: FILLER_COUNT }).map((_, i) => {
      const h = Math.random() * (TREE_HEIGHT - 1.5) + 1; 
      const r = (TREE_RADIUS_BASE * (1 - h/TREE_HEIGHT)) * 0.85 * Math.random(); 
      const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(r * Math.cos(theta), h, r * Math.sin(theta));

      const u = Math.random(), v = Math.random();
      const theta2 = 2 * Math.PI * u, phi = Math.acos(2 * v - 1), r2 = Math.cbrt(Math.random()) * CHAOS_RADIUS;
      const chaosPos = new THREE.Vector3(r2 * Math.sin(phi)*Math.cos(theta2), r2*Math.sin(phi)*Math.sin(theta2)+5, r2*Math.cos(phi));
      
      const mixRatio = Math.random();
      const color = new THREE.Color().lerpColors(COLORS.RIBBON_RED, COLORS.GOLD, mixRatio);
      return { targetPos, chaosPos, scale: Math.random()*0.4+0.2, color, speed: Math.random()*0.05+0.01, currentPos: chaosPos.clone(), initialRotation: new THREE.Euler(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI) };
    });
  }, []);

  useLayoutEffect(() => {
    if (meshRef.current) {
        data.forEach((d, i) => {
            tempObject.position.copy(d.targetPos);
            tempObject.scale.setScalar(d.scale);
            tempObject.rotation.copy(d.initialRotation);
            tempObject.updateMatrix();
            meshRef.current!.setMatrixAt(i, tempObject.matrix);
            meshRef.current!.setColorAt(i, d.color);
        });
        meshRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [data]);

  useFrame((state) => {
    if (!meshRef.current) return;
    const time = state.clock.elapsedTime;
    data.forEach((d, i) => {
      const dest = progress > 0.5 ? d.chaosPos : d.targetPos;
      d.currentPos.lerp(dest, d.speed);
      tempObject.position.copy(d.currentPos);
      tempObject.rotation.set(d.initialRotation.x + time * 0.5, d.initialRotation.y + time * 0.5, d.initialRotation.z);
      tempObject.scale.setScalar(d.scale);
      tempObject.updateMatrix();
      meshRef.current!.setMatrixAt(i, tempObject.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, FILLER_COUNT]}>
      <boxGeometry args={[1, 1, 1]} /> 
      <meshStandardMaterial roughness={0.3} metalness={0.8} />
    </instancedMesh>
  );
};

// 4.5 TOP STAR
const TopStar: React.FC<{ progress: number }> = ({ progress }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const starShape = useMemo(() => {
    const shape = new THREE.Shape();
    const points = 5;
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? 1.2 : 0.5;
      const a = (i / (points * 2)) * Math.PI * 2;
      const x = Math.cos(a + Math.PI / 2) * r;
      const y = Math.sin(a + Math.PI / 2) * r;
      if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    }
    shape.closePath();
    return shape;
  }, []);

  const targetPos = new THREE.Vector3(0, TREE_HEIGHT + 0.5, 0);
  const chaosPos = new THREE.Vector3(0, CHAOS_RADIUS * 0.8, 0);

  useFrame((state) => {
    if (!meshRef.current) return;
    const dest = progress > 0.5 ? chaosPos : targetPos;
    meshRef.current.position.lerp(dest, 0.05);
    if (progress > 0.5) {
       meshRef.current.rotation.y += 0.05; meshRef.current.rotation.z += 0.02;
    } else {
       meshRef.current.rotation.y = state.clock.elapsedTime * 0.5;
       meshRef.current.rotation.z = THREE.MathUtils.lerp(meshRef.current.rotation.z, 0, 0.1);
       meshRef.current.rotation.x = THREE.MathUtils.lerp(meshRef.current.rotation.x, 0, 0.1);
    }
  });

  return (
    <mesh ref={meshRef} position={[0, TREE_HEIGHT, 0]}>
      <extrudeGeometry args={[starShape, { depth: 0.4, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 2 }]} />
      <meshStandardMaterial color={COLORS.GOLD} emissive={COLORS.GOLD} emissiveIntensity={0.5} metalness={1} roughness={0.1} />
    </mesh>
  );
};

// --- 5. EXPERIENCE & APP ---

const Rig: React.FC<{ gestureData: GestureData }> = ({ gestureData }) => {
  const { camera } = useThree();
  useFrame(() => {
    const targetX = CAMERA_POS.x + (gestureData.handX * 10);
    const targetY = CAMERA_POS.y + (gestureData.handY * 5);
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetX, 0.05);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetY, 0.05);
    camera.lookAt(0, 6, 0);
  });
  return null;
};

const Experience: React.FC<{ gestureData: GestureData; customPhotos: string[] }> = ({ gestureData, customPhotos }) => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const target = gestureData.state === TreeState.CHAOS ? 1 : 0;
    let frameId: number;
    const animate = () => {
      setProgress(prev => {
        const diff = target - prev;
        if (Math.abs(diff) < 0.001) return target;
        return prev + diff * 0.05;
      });
      frameId = requestAnimationFrame(animate);
    };
    animate();
    return () => cancelAnimationFrame(frameId);
  }, [gestureData.state]);

  return (
    <Canvas gl={{ antialias: false, toneMapping: THREE.ReinhardToneMapping, toneMappingExposure: 1.5 }} dpr={[1, 2]}>
      <PerspectiveCamera makeDefault position={CAMERA_POS.toArray()} fov={50} />
      <Rig gestureData={gestureData} />
      <color attach="background" args={['#050505']} />
      <ambientLight intensity={0.5} color="#ffd700" />
      <spotLight position={[10, 20, 10]} angle={0.3} penumbra={1} intensity={2} color="#fff" castShadow />
      <pointLight position={[-10, 5, -10]} intensity={1} color="#004225" />
      <group position={[0, 0, 0]}>
         <Fillers progress={progress} />
         <Foliage progress={progress} />
         <Ornaments progress={progress} />
         <Polaroids progress={progress} photos={customPhotos} />
         <TopStar progress={progress} />
         <mesh position={[0, 1, 0]}>
           <cylinderGeometry args={[1, 1.5, 2, 8]} />
           <meshStandardMaterial color="#3E2723" />
         </mesh>
      </group>
      <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
      <Environment preset="lobby" background={false} />
      <EffectComposer disableNormalPass>
        <Bloom luminanceThreshold={0.8} mipmapBlur intensity={1.2} radius={0.4} />
        <Vignette eskil={false} offset={0.1} darkness={1.1} />
      </EffectComposer>
    </Canvas>
  );
};

const App = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hasPermission, setHasPermission] = useState(false);
  const [apiKeyMissing, setApiKeyMissing] = useState(false);
  const [customPhotos, setCustomPhotos] = useState<string[]>([]);
  const [gestureData, setGestureData] = useState<GestureData>({ state: TreeState.FORMED, handX: 0, handY: 0 });

  useEffect(() => {
    if (!process.env.API_KEY) setApiKeyMissing(true);
    const startWebcam = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play();
            setHasPermission(true);
            if (process.env.API_KEY) {
                geminiService.connect(videoRef.current!, (data) => {
                  setGestureData(prev => {
                    const newState = data.state === TreeState.CHAOS ? TreeState.CHAOS : prev.state;
                    return { state: newState, handX: data.handX, handY: data.handY };
                  });
                });
            }
          };
        }
      } catch (err) { console.error("Error accessing webcam:", err); }
    };
    startWebcam();
    return () => { geminiService.disconnect(); };
  }, []);

  const toggleSimulation = () => {
    setGestureData(prev => ({ ...prev, state: prev.state === TreeState.FORMED ? TreeState.CHAOS : TreeState.FORMED }));
  };

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    const fileList = Array.from(files);
    const promises = fileList.map(file => new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.readAsDataURL(file as Blob);
    }));
    try { const images = await Promise.all(promises); setCustomPhotos(images); } catch (error) {}
  };

  return (
    <div className="relative w-full h-screen bg-black">
      <div className="absolute inset-0 z-0"><Experience gestureData={gestureData} customPhotos={customPhotos} /></div>
      <input type="file" ref={fileInputRef} className="hidden" multiple accept="image/*" onChange={handleFileChange} />
      <div className="absolute inset-0 pointer-events-none z-10 flex flex-col justify-between p-8">
        <header className="flex flex-col items-center">
          <h1 className="text-5xl font-bold tracking-widest uppercase font-serif gold-text drop-shadow-lg text-center">CHRISTMAS GIVEAWAY!</h1>
          <p className="text-white/70 text-sm mt-2 font-serif italic tracking-wider">WIN a Jovikid iSize Car Seat!</p>
        </header>
        <div className="flex justify-between items-end">
          <div className="flex flex-col gap-4 pointer-events-auto">
            <div className="bg-black/40 backdrop-blur-md border border-[#C0C0C0]/30 p-4 rounded-lg text-white font-mono text-xs w-64">
              <h3 className="text-[#FFD700] mb-2 uppercase border-b border-[#FFD700]/30 pb-1">System Status</h3>
              <div className="flex justify-between mb-1"><span>MODE:</span><span className={gestureData.state === TreeState.CHAOS ? "text-red-400 font-bold" : "text-green-400 font-bold"}>{gestureData.state}</span></div>
              <div className="flex justify-between mb-1"><span>HAND X:</span><span>{gestureData.handX.toFixed(2)}</span></div>
              <div className="flex justify-between"><span>HAND Y:</span><span>{gestureData.handY.toFixed(2)}</span></div>
              {apiKeyMissing && (<div className="mt-2 text-red-500 font-bold border-t border-red-500 pt-1">API KEY MISSING</div>)}
            </div>
            <div className="flex gap-2">
              <button onClick={toggleSimulation} className="bg-black/60 backdrop-blur-md border border-[#FFD700] text-[#FFD700] px-4 py-3 rounded-lg font-serif tracking-widest hover:bg-[#FFD700]/20 active:bg-[#FFD700]/40 transition-all uppercase text-xs flex items-center justify-center gap-2 group"><span className="w-2 h-2 rounded-full bg-[#FFD700] group-hover:animate-pulse"></span>{gestureData.state === TreeState.FORMED ? 'Simulate Unleash' : 'Restore Tree'}</button>
              <button onClick={handleUploadClick} className="bg-black/60 backdrop-blur-md border border-[#C0C0C0] text-[#C0C0C0] px-4 py-3 rounded-lg font-serif tracking-widest hover:bg-[#C0C0C0]/20 active:bg-[#C0C0C0]/40 transition-all uppercase text-xs flex items-center justify-center gap-2">Upload Photos</button>
            </div>
          </div>
          <div className="relative group pointer-events-auto">
            <video ref={videoRef} className="w-48 h-36 object-cover rounded-lg border-2 border-[#FFD700] opacity-50 hover:opacity-100 transition-opacity" muted playsInline />
            {!hasPermission && !apiKeyMissing && (<div className="absolute inset-0 flex items-center justify-center text-white text-xs text-center bg-black/50">Awaiting Camera Access...</div>)}
            <div className="absolute -top-10 right-0 bg-black/60 text-white text-xs px-2 py-1 rounded">Show <span className="text-[#FFD700]">Open Hand</span> to Unleash<br/>Click Button to Restore</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- 6. RENDER ---
const rootElement = document.getElementById('root');
if (rootElement) {
  const loadingEl = document.getElementById('loading');
  if (loadingEl) loadingEl.style.display = 'none';
  const root = ReactDOM.createRoot(rootElement);
  root.render(<React.StrictMode><App /></React.StrictMode>);
}