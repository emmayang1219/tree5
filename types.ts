export enum TreeState {
  CHAOS = 'CHAOS',
  FORMED = 'FORMED'
}

export interface GestureData {
  state: TreeState;
  handX: number; // -1 to 1 (left to right)
  handY: number; // -1 to 1 (bottom to top)
}

export interface IGeminiService {
  connect: (videoElement: HTMLVideoElement, onData: (data: GestureData) => void) => Promise<void>;
  disconnect: () => void;
}
