import React, { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { initScene } from '../lib/three/sceneSetup';
import { buildGraph } from '../lib/three/graphBuilder';
import { addAtmosphericEffects, animateAtmosphericEffects } from '../lib/three/atmosphericEffects';
import type { CommitNode, RepoData } from '../types';

interface GitGalaxyCanvasProps {
  repoData: RepoData;
  onCommitSelect: (commit: { hash: string, node: CommitNode } | null) => void;
  selectedCommit: { hash:string, node: CommitNode } | null;
  filteredAuthor: string | null;
  timelineCommitLimit: number | null;
}

const GitGalaxyCanvas: React.FC<GitGalaxyCanvasProps> = ({ 
  repoData, 
  onCommitSelect, 
  selectedCommit,
  filteredAuthor,
  timelineCommitLimit 
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({
    stars: null as THREE.Points | null,
    commitHashes: [] as string[],
    particles: null as THREE.Points | null,
    camera: null as THREE.PerspectiveCamera | null,
    controls: null as any,
    composer: null as any,
    isZooming: false,
    zoomTarget: null as THREE.Vector3 | null,
    zoomStartPos: null as THREE.Vector3 | null,
    zoomStartTarget: null as THREE.Vector3 | null,
    zoomStartTime: 0,
  });

  const updateCommitColors = useCallback(() => {
    const { stars, commitHashes } = stateRef.current;
    if (!stars || !repoData) return;

    const colors = stars.geometry.attributes.color;
    if (!colors) return;
    
    // Update colors
    for (let i = 0; i < commitHashes.length; i++) {
        const currentHash = commitHashes[i];
        const node = repoData[currentHash];
        if (!node) continue;
        
        if (currentHash === selectedCommit?.hash) {
            // Highlight selected: yellow
            colors.setXYZ(i, 1.0, 1.0, 0.0);
        } else if (filteredAuthor && node.author === filteredAuthor) {
            // Filtered author: use branch color or cyan
            if (node.branchColor) {
                const color = new THREE.Color(node.branchColor);
                colors.setXYZ(i, color.r, color.g, color.b);
            } else {
                colors.setXYZ(i, 0.0, 1.0, 1.0); // Cyan
            }
        } else if (filteredAuthor && node.author !== filteredAuthor) {
            // Dimmed: gray
            colors.setXYZ(i, 0.3, 0.3, 0.3);
        } else {
            // Default: white or branch color
            if (node.branchColor) {
                const color = new THREE.Color(node.branchColor);
                colors.setXYZ(i, color.r, color.g, color.b);
            } else {
                colors.setXYZ(i, 1.0, 1.0, 1.0);
            }
        }
    }
    colors.needsUpdate = true;
  }, [repoData, selectedCommit, filteredAuthor]);

  // Update colors in useEffect (like original commit and ConstellationCanvas) - NOT in render loop
  // This prevents bloom accumulation from mid-frame color updates
  useEffect(() => {
    if (stateRef.current.stars) {
      updateCommitColors();
    }
  }, [selectedCommit, filteredAuthor, updateCommitColors]);


  useEffect(() => {
    if (!canvasRef.current || !repoData) return;

    // Apply timeline filter if set
    let filteredRepoData = repoData;
    if (timelineCommitLimit !== null) {
      const allHashes = Object.keys(repoData);
      const limitedHashes = allHashes.slice(0, timelineCommitLimit);
      filteredRepoData = {} as RepoData;
      limitedHashes.forEach(hash => {
        filteredRepoData[hash] = repoData[hash];
      });
    }

    const { scene, camera, renderer, controls, composer, handleResize } = initScene(canvasRef.current);
    const { stars } = buildGraph(scene, filteredRepoData);
    const { particles } = addAtmosphericEffects(scene);
    
    const commitHashes = Object.keys(filteredRepoData);
    stateRef.current.stars = stars;
    stateRef.current.commitHashes = commitHashes;
    stateRef.current.particles = particles;
    stateRef.current.camera = camera;
    stateRef.current.controls = controls;
    stateRef.current.composer = composer;
    
    // Initial color update
    updateCommitColors();
    
    // Function to zoom camera to a specific position
    const zoomToPosition = (targetPos: THREE.Vector3) => {
      if (!controls || !camera) return;
      
      // Disable auto-rotate during zoom
      controls.autoRotate = false;
      
      // Store zoom state
      stateRef.current.isZooming = true;
      stateRef.current.zoomTarget = targetPos.clone();
      stateRef.current.zoomStartPos = camera.position.clone();
      stateRef.current.zoomStartTarget = controls.target.clone();
      stateRef.current.zoomStartTime = Date.now();
    };
    
    // Raycasting
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    raycaster.params.Points.threshold = 0.5;

    const onClick = (event: MouseEvent) => {
      if (!canvasRef.current || !stateRef.current.stars) return;

      mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.y = - (event.clientY / window.innerHeight) * 2 + 1;
      
      raycaster.setFromCamera(mouse, camera);

      const intersects = raycaster.intersectObject(stateRef.current.stars);
      
      if (intersects.length > 0) {
        const intersection = intersects[0];
        if (intersection.index !== undefined) {
          const hash = stateRef.current.commitHashes[intersection.index];
          const node = filteredRepoData[hash] || repoData[hash];
          if (node) {
            onCommitSelect({ hash, node });
            // Zoom to the clicked node
            const nodePosition = new THREE.Vector3(...node.pos);
            zoomToPosition(nodePosition);
          }
        }
      } else {
        onCommitSelect(null);
      }
    };

    window.addEventListener('resize', handleResize);
    canvasRef.current.addEventListener('click', onClick);

    const clock = new THREE.Clock();
    const tick = () => {
      const elapsedTime = clock.getElapsedTime();

      // Handle zoom animation
      if (stateRef.current.isZooming && stateRef.current.zoomTarget && stateRef.current.zoomStartPos && stateRef.current.zoomStartTarget) {
        const duration = 1000; // 1 second
        const elapsed = Date.now() - stateRef.current.zoomStartTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Calculate new camera position
        const distance = 3;
        const direction = new THREE.Vector3().subVectors(stateRef.current.zoomStartPos, stateRef.current.zoomTarget).normalize();
        const endPosition = new THREE.Vector3().addVectors(stateRef.current.zoomTarget, direction.multiplyScalar(distance));
        
        if (progress < 1) {
          // Ease out cubic
          const eased = 1 - Math.pow(1 - progress, 3);
          
          // Lerp camera position
          camera.position.lerpVectors(stateRef.current.zoomStartPos, endPosition, eased);
          
          // Lerp controls target
          controls.target.lerpVectors(stateRef.current.zoomStartTarget, stateRef.current.zoomTarget, eased);
        } else {
          // Animation complete - ensure controls are updated to final position
          camera.position.copy(endPosition);
          controls.target.copy(stateRef.current.zoomTarget);
          controls.update();
          
          stateRef.current.isZooming = false;
          stateRef.current.zoomTarget = null;
          stateRef.current.zoomStartPos = null;
          stateRef.current.zoomStartTarget = null;
        }
      }

      if (stateRef.current.particles) {
        animateAtmosphericEffects(stateRef.current.particles, elapsedTime);
      }

      if (stateRef.current.controls) {
        stateRef.current.controls.update();
      }

      if (stateRef.current.composer) {
        stateRef.current.composer.render();
      }

      window.requestAnimationFrame(tick);
    };

    tick();

    return () => {
      window.removeEventListener('resize', handleResize);
      canvasRef.current?.removeEventListener('click', onClick);
      renderer.dispose();
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
          object.geometry.dispose();
          const material = object.material as THREE.Material | THREE.Material[];
          if (Array.isArray(material)) {
            material.forEach(mat => mat.dispose());
          } else {
            material.dispose();
          }
        }
      });
    };
  }, [repoData, timelineCommitLimit, updateCommitColors, onCommitSelect]);

  return <canvas ref={canvasRef} className="webgl fixed top-0 left-0 outline-none" />;
};

export default GitGalaxyCanvas;