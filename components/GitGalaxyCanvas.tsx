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
}

const GitGalaxyCanvas: React.FC<GitGalaxyCanvasProps> = ({ repoData, onCommitSelect, selectedCommit }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({
    stars: null as THREE.Points | null,
    commitHashes: [] as string[],
    particles: null as THREE.Points | null,
  });

  const highlightCommit = useCallback((hash: string | null) => {
    const { stars, commitHashes } = stateRef.current;
    if (!stars) return;

    const colors = stars.geometry.attributes.color;
    if (!colors) return;
    
    for (let i = 0; i < commitHashes.length; i++) {
        const currentHash = commitHashes[i];
        if (currentHash === hash) {
            // Highlight selected: yellow
            colors.setXYZ(i, 1.0, 1.0, 0.0);
        } else {
            // Default color: white
            colors.setXYZ(i, 1.0, 1.0, 1.0);
        }
    }
    colors.needsUpdate = true;
  }, []);

  useEffect(() => {
    if (selectedCommit) {
      highlightCommit(selectedCommit.hash);
    } else {
      highlightCommit(null);
    }
  }, [selectedCommit, highlightCommit]);


  useEffect(() => {
    if (!canvasRef.current || !repoData) return;

    const { scene, camera, renderer, controls, composer, handleResize } = initScene(canvasRef.current);
    const { stars } = buildGraph(scene, repoData);
    const { particles } = addAtmosphericEffects(scene);
    
    const commitHashes = Object.keys(repoData);
    stateRef.current.stars = stars;
    stateRef.current.commitHashes = commitHashes;
    stateRef.current.particles = particles;
    
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
          const node = repoData[hash];
          onCommitSelect({ hash, node });
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
      
      animateAtmosphericEffects(stateRef.current.particles, elapsedTime);
      controls.update();
      composer.render();
      
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
  }, [repoData, onCommitSelect]);

  return <canvas ref={canvasRef} className="webgl fixed top-0 left-0 outline-none" />;
};

export default GitGalaxyCanvas;