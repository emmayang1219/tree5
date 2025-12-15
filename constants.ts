import { Vector3, Color } from 'three';
import React from 'react';

// Fix for React Three Fiber JSX types
// Augment global JSX namespace for older setups or where global JSX is used
declare global {
  namespace JSX {
    interface IntrinsicElements {
      ambientLight: any;
      pointLight: any;
      spotLight: any;
      directionalLight: any;
      color: any;
      group: any;
      mesh: any;
      cylinderGeometry: any;
      meshStandardMaterial: any;
      sphereGeometry: any;
      instancedMesh: any;
      points: any;
      bufferGeometry: any;
      bufferAttribute: any;
      shaderMaterial: any;
      boxGeometry: any;
      extrudeGeometry: any;
      planeGeometry: any;
      primitive: any;
      [elemName: string]: any;
    }
  }
}

// Visual Style
export const COLORS = {
  EMERALD: new Color('#004225'),
  GOLD: new Color('#FFD700'),
  SILVER: new Color('#C0C0C0'),
  RIBBON_RED: new Color('#8B0000'),
  GLOW: new Color('#FFECB3'),
};

// Tree Dimensions (Shrunk further for a denser, cuter look)
export const TREE_HEIGHT = 12; 
export const TREE_RADIUS_BASE = 5.0;
export const CHAOS_RADIUS = 35;

// Particle Counts
export const FOLIAGE_COUNT = 15000;
export const ORNAMENT_COUNT = 400;
export const FILLER_COUNT = 1200; // Increased significantly to fill the void
export const POLAROID_COUNT = 30;

// Camera
export const CAMERA_POS = new Vector3(0, 3, 20); // Moved closer for the smaller tree